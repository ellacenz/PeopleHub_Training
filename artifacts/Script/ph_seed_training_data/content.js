/**
 * PeopleHub Leave - training data seed.
 * Re-runnable: wipes both PH_ tables and inserts a known training state.
 * Pass { "keepRequests": true } to only reset the user mapping.
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

try {
    var body = req.body || {};
    var now = Date.now();
    var who = 'seed';

    // The Neptune user names that should map to the two SAP test persons.
    // employeeUser -> PERNR 00000029 (Bruce Smith), managerUser -> 00000030 (Bill West)
    var employeeUser = body.employeeUser || 'trainee';
    var managerUser = body.managerUser || 'manager';

    // ---------------------------------------------------------- PH_USER_MAP
    await entityManager.query('DELETE FROM entityset_peoplehubusermap');

    var mapRows = [
        { u: employeeUser, p: '00000029', r: 'EMPLOYEE' },
        { u: managerUser, p: '00000030', r: 'MANAGER' }
    ];
    for (var i = 0; i < mapRows.length; i++) {
        var m = mapRows[i];
        await entityManager.query(
            'INSERT INTO entityset_peoplehubusermap ' +
            '("USER_NAME", "PERNR", "ROLE", "createdAt", "updatedAt", "createdBy", "updatedBy") ' +
            'VALUES (' + lit(m.u) + ', ' + lit(m.p) + ', ' + lit(m.r) + ', ' +
            num(now) + ', ' + num(now) + ', ' + lit(who) + ', ' + lit(who) + ')'
        );
    }

    // ------------------------------------------------------ PH_LEAVE_REQUEST
    var requestCount = 0;
    if (!body.keepRequests) {
        await entityManager.query('DELETE FROM entityset_peoplehubleaverequest');

        // A small, readable set so trainees immediately see every status and
        // the manager has something to approve.
        var demo = [
            { pernr: '00000029', name: 'Bruce Smith', mgr: '00000030',
              from: '2026-12-21', to: '2026-12-23', days: 3,
              comment: 'Christmas break', status: 'PENDING', src: 'APP' },
            { pernr: '00000031', name: 'Team Member 31', mgr: '00000030',
              from: '2026-11-19', to: '2026-11-20', days: 2,
              comment: 'Family event', status: 'APPROVED', src: 'APP' },
            { pernr: '00000033', name: 'Team Member 33', mgr: '00000030',
              from: '2026-12-07', to: '2026-12-07', days: 1,
              comment: 'Drafted by the HR Assistant', status: 'PENDING', src: 'AI' },
            { pernr: '00000035', name: 'Team Member 35', mgr: '00000030',
              from: '2026-11-30', to: '2026-12-04', days: 5,
              comment: 'Long weekend trip', status: 'APPROVED', src: 'APP' },
            { pernr: '00000029', name: 'Bruce Smith', mgr: '00000030',
              from: '2026-10-05', to: '2026-10-06', days: 2,
              comment: 'Short break', status: 'REJECTED', src: 'APP' }
        ];

        for (var j = 0; j < demo.length; j++) {
            var d = demo[j];
            var decided = (d.status === 'APPROVED' || d.status === 'REJECTED');
            await entityManager.query(
                'INSERT INTO entityset_peoplehubleaverequest ' +
                '("PERNR", "EMPLOYEE_NAME", "MANAGER_PERNR", "AWART", "TYPE_TEXT", ' +
                '"START_DATE", "END_DATE", "WORKING_DAYS", "COMMENT", "STATUS", ' +
                '"DECISION_COMMENT", "DECIDED_BY", "DECIDED_AT", "CREATED_AT_APP", "SOURCE", ' +
                '"createdAt", "updatedAt", "createdBy", "updatedBy") VALUES (' +
                lit(d.pernr) + ', ' + lit(d.name) + ', ' + lit(d.mgr) + ", '0100', 'Leave', " +
                lit(d.from) + ', ' + lit(d.to) + ', ' + num(d.days) + ', ' +
                lit(d.comment) + ', ' + lit(d.status) + ', ' +
                (d.status === 'REJECTED' ? lit('Too close to the course week') : 'NULL') + ', ' +
                (decided ? lit('00000030') : 'NULL') + ', ' +
                (decided ? num(now) : 'NULL') + ', ' +
                num(now - (demo.length - j) * 86400000) + ', ' + lit(d.src) + ', ' +
                num(now) + ', ' + num(now) + ', ' + lit(who) + ', ' + lit(who) + ')'
            );
            requestCount++;
        }
    }

    var checkMap = await entityManager.query('SELECT "USER_NAME", "PERNR", "ROLE" FROM entityset_peoplehubusermap');
    result.data = {
        ok: true,
        userMapRows: checkMap,
        leaveRequestRows: requestCount
    };
    result.statusCode = 200;
} catch (e) {
    log.info('ph_seed_training_data error: ' + (e && e.message ? e.message : e));
    result.data = { error: String(e && e.message ? e.message : e) };
    result.statusCode = 500;
}
