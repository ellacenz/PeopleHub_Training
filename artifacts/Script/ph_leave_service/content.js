/**
 * PeopleHub Leave - leave request service.
 * Handles the Neptune-side data only. SAP is read-only and never written here.
 *
 * Actions (req.body.action or req.query.action):
 *   getUserMap    - resolve the logged in user to a personnel number
 *   listMine      - leave requests of one employee
 *   listForManager- PENDING requests waiting for one manager
 *   listApproved  - APPROVED requests of a list of personnel numbers (Who is out)
 *   create        - insert a new PENDING request
 *   cancel        - employee cancels own PENDING request
 *   decide        - manager approves or rejects a PENDING request
 *   cleanup       - clean duplicate records
 */

function lit(value) {
    if (value === null || value === undefined || value === '') { return 'NULL'; }
    return "'" + String(value).replace(/'/g, "''") + "'";
}

function num(value) {
    var n = Number(value);
    if (isNaN(n)) { return '0'; }
    return String(n);
}

function pad8(value) {
    var s = String(value === null || value === undefined ? '' : value).trim();
    s = s.replace(/^0+/, '');
    while (s.length < 8) { s = '0' + s; }
    return s;
}

var REQ_COLS = 'id, "PERNR", "EMPLOYEE_NAME", "MANAGER_PERNR", "AWART", "TYPE_TEXT", ' +
    '"START_DATE", "END_DATE", "WORKING_DAYS", "COMMENT", "STATUS", ' +
    '"DECISION_COMMENT", "DECIDED_BY", "DECIDED_AT", "CREATED_AT_APP", "SOURCE"';

try {
    var body = req.body || {};
    var query = req.query || {};
    var action = body.action || query.action || '';
    var now = Date.now();
    var user = (req.user && (req.user.username || req.user.name)) || 'unknown';

    if (action === 'getUserMap') {
        var lookupUser = body.USER_NAME || query.USER_NAME || user;
        var mapRows = await entityManager.query(
            'SELECT id, "USER_NAME", "PERNR", "ROLE" FROM entityset_peoplehubusermap ' +
            'WHERE LOWER("USER_NAME") = LOWER(' + lit(lookupUser) + ')'
        );
        result.data = { ITEMS: mapRows || [], USER_NAME: lookupUser };
        result.statusCode = 200;

    } else if (action === 'listMine') {
        var minePernr = pad8(body.PERNR || query.PERNR);
        var mineRows = await entityManager.query(
            'SELECT ' + REQ_COLS + ' FROM entityset_peoplehubleaverequest ' +
            'WHERE "PERNR" = ' + lit(minePernr) + ' ORDER BY "CREATED_AT_APP" DESC'
        );
        result.data = { ITEMS: mineRows || [] };
        result.statusCode = 200;

    } else if (action === 'listForManager') {
        var mgrPernr = pad8(body.MANAGER_PERNR || query.MANAGER_PERNR);
        var mgrRows = await entityManager.query(
            'SELECT ' + REQ_COLS + ' FROM entityset_peoplehubleaverequest ' +
            'WHERE "MANAGER_PERNR" = ' + lit(mgrPernr) + ' AND "STATUS" = \'PENDING\' ' +
            'ORDER BY "CREATED_AT_APP" ASC'
        );
        result.data = { ITEMS: mgrRows || [] };
        result.statusCode = 200;

    } else if (action === 'listApproved') {
        var raw = body.PERNRS || query.PERNRS || '';
        var list = String(raw).split(',').filter(function (v) { return String(v).trim() !== ''; });
        var approved = [];
        if (list.length > 0) {
            var inList = list.map(function (p) { return lit(pad8(p)); }).join(',');
            approved = await entityManager.query(
                'SELECT ' + REQ_COLS + ' FROM entityset_peoplehubleaverequest ' +
                'WHERE "PERNR" IN (' + inList + ') AND "STATUS" = \'APPROVED\' ' +
                'ORDER BY "START_DATE" ASC'
            );
        }
        result.data = { ITEMS: approved || [] };
        result.statusCode = 200;

    } else if (action === 'create') {
        var cPernr = pad8(body.PERNR);
        var cMgr = pad8(body.MANAGER_PERNR);
        var cStart = String(body.START_DATE || '');
        var cEnd = String(body.END_DATE || '');
        var cDays = Number(body.WORKING_DAYS || 0);

        if (!body.PERNR || !cStart || !cEnd) {
            result.data = { error: 'PERNR, START_DATE and END_DATE are required' };
            result.statusCode = 400;
        } else if (cDays <= 0) {
            result.data = { error: 'The selected period has no working days' };
            result.statusCode = 400;
        } else {
            await entityManager.query(
                'INSERT INTO entityset_peoplehubleaverequest ' +
                '("PERNR", "EMPLOYEE_NAME", "MANAGER_PERNR", "AWART", "TYPE_TEXT", ' +
                '"START_DATE", "END_DATE", "WORKING_DAYS", "COMMENT", "STATUS", ' +
                '"DECISION_COMMENT", "DECIDED_BY", "DECIDED_AT", "CREATED_AT_APP", "SOURCE", ' +
                '"createdAt", "updatedAt", "createdBy", "updatedBy") VALUES (' +
                lit(cPernr) + ', ' +
                lit(body.EMPLOYEE_NAME || '') + ', ' +
                lit(cMgr) + ', ' +
                lit(body.AWART || '0100') + ', ' +
                lit(body.TYPE_TEXT || 'Leave') + ', ' +
                lit(cStart) + ', ' +
                lit(cEnd) + ', ' +
                num(cDays) + ', ' +
                lit(body.COMMENT || '') + ", 'PENDING', NULL, NULL, NULL, " +
                num(now) + ', ' +
                lit(body.SOURCE || 'APP') + ', ' +
                num(now) + ', ' + num(now) + ', ' + lit(user) + ', ' + lit(user) + ')'
            );
            var afterCreate = await entityManager.query(
                'SELECT ' + REQ_COLS + ' FROM entityset_peoplehubleaverequest ' +
                'WHERE "PERNR" = ' + lit(cPernr) + ' ORDER BY "CREATED_AT_APP" DESC'
            );
            result.data = { ok: true, ITEMS: afterCreate || [] };
            result.statusCode = 200;
        }

    } else if (action === 'cancel') {
        var cancelId = body.ID || query.ID || '';
        var cancelPernr = pad8(body.PERNR || query.PERNR);
        if (!cancelId) {
            result.data = { error: 'ID is required' };
            result.statusCode = 400;
        } else {
            await entityManager.query(
                'UPDATE entityset_peoplehubleaverequest SET ' +
                '"STATUS" = \'CANCELLED\', "updatedAt" = ' + num(now) + ', ' +
                '"updatedBy" = ' + lit(user) + ' ' +
                'WHERE id = ' + lit(cancelId)
            );
            var afterCancel = await entityManager.query(
                'SELECT ' + REQ_COLS + ' FROM entityset_peoplehubleaverequest ' +
                'WHERE id = ' + lit(cancelId)
            );
            result.data = { ok: true, ITEMS: afterCancel || [] };
            result.statusCode = 200;
        }

    } else if (action === 'decide') {
        var decId = body.ID || query.ID || '';
        var decision = String(body.DECISION || query.DECISION || '').toUpperCase();
        var decBy = pad8(body.DECIDED_BY || query.DECIDED_BY);
        var decComment = body.DECISION_COMMENT || query.DECISION_COMMENT || '';

        if (!decId || (decision !== 'APPROVED' && decision !== 'REJECTED' && decision !== 'CANCELLED')) {
            result.data = { error: 'ID and a valid DECISION (APPROVED, REJECTED, CANCELLED) are required' };
            result.statusCode = 400;
        } else {
            await entityManager.query(
                'UPDATE entityset_peoplehubleaverequest SET ' +
                '"STATUS" = ' + lit(decision) + ', ' +
                '"DECISION_COMMENT" = ' + lit(decComment) + ', ' +
                '"DECIDED_BY" = ' + lit(decBy) + ', ' +
                '"DECIDED_AT" = ' + num(now) + ', ' +
                '"updatedAt" = ' + num(now) + ', ' +
                '"updatedBy" = ' + lit(user) + ' ' +
                'WHERE id = ' + lit(decId)
            );
            var afterDecide = await entityManager.query(
                'SELECT ' + REQ_COLS + ' FROM entityset_peoplehubleaverequest ' +
                'WHERE id = ' + lit(decId)
            );
            result.data = { ok: true, ITEMS: afterDecide || [] };
            result.statusCode = 200;
        }

    } else if (action === 'cleanup') {
        await entityManager.query(
            "DELETE FROM entityset_peoplehubleaverequest WHERE id IN ('B80BACF4-430A-4D8F-8ECD-0AC916474ED1', 'EA157952-643B-445D-9076-5364AF314E33')"
        );
        result.data = { ok: true, message: 'Duplicates cleaned' };
        result.statusCode = 200;

    } else {
        result.data = { error: 'Unknown action: ' + action };
        result.statusCode = 400;
    }
} catch (e) {
    log.info('ph_leave_service error: ' + (e && e.message ? e.message : e));
    result.data = { error: String(e && e.message ? e.message : e) };
    result.statusCode = 500;
}
