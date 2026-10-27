function initData() {
    modelView.setData({
        user: { username: '', isRequester: false, isApprover: false },
        canEditReceipts: false,
        pendingReceipt: null,
        started: false,
        syncing: false,
        offline: false,
        showOfflineStrip: false,
        offlineText: '',
        offlineType: 'Information'
    });
    modelFilterModel.setData({
        STATUS_OPTIONS: [
            { key: 'ALL', text: 'All Statuses' },
            { key: 'Draft', text: 'Draft' },
            { key: 'Submitted', text: 'Submitted' },
            { key: 'Approved', text: 'Approved' },
            { key: 'Rejected', text: 'Rejected' }
        ],
        RAW_CLAIMS: []
    });

    modelClaims.setData({ ITEMS: [] });
    modelClaimsDetail.setData({});
    modelClaimLines.setData({ ITEMS: [] });
    modelPolicies.setData({ ITEMS: [] });

    window.addEventListener('offline', onWentOffline);
    window.addEventListener('online', onBackOnline);

    // The app starts when OfflineStore has been read from the device (onOfflineStoreLoaded)
    setTimeout(startApp, 2000);
}

function onClaimsDataLoaded(xhr) {
    var response = xhr.responseJSON || [];
    var items = Array.isArray(response) ? response : [];

    items.forEach(function(item) {
        var st = (item.status || '').toLowerCase();
        if (st === 'approved') {
            item.statusState = 'Success';
        } else if (st === 'submitted') {
            item.statusState = 'Warning';
        } else if (st === 'rejected') {
            item.statusState = 'Error';
        } else {
            item.statusState = 'Information';
        }
    });

    if (!isOffline()) saveOfflineStore({ claims: items });
    modelFilterModel.setProperty('/RAW_CLAIMS', items);
    applyClaimsFilter();
}

function applyClaimsFilter() {
    var raw = modelFilterModel.getProperty('/RAW_CLAIMS') || [];
    var query = (searchClaims.getValue() || '').toLowerCase().trim();
    var status = selFilterStatus.getSelectedKey() || 'ALL';

    var filtered = raw.filter(function(item) {
        var matchStatus = (status === 'ALL' || item.status === status);
        var matchQuery = !query ||
            (item.title && item.title.toLowerCase().indexOf(query) !== -1) ||
            (item.purpose && item.purpose.toLowerCase().indexOf(query) !== -1) ||
            (item.claimid && item.claimid.toLowerCase().indexOf(query) !== -1) ||
            (item.createdByPerson && item.createdByPerson.toLowerCase().indexOf(query) !== -1);
        return matchStatus && matchQuery;
    });

    modelClaims.setData({ ITEMS: filtered });
}

function onPoliciesDataLoaded(xhr) {
    var response = xhr.responseJSON || [];
    var items = Array.isArray(response) ? response : [];

    items.forEach(function(item) {
        if (item.blocking) {
            item.blockingState = 'Error';
            item.blockingText = 'Blocking';
        } else {
            item.blockingState = 'Information';
            item.blockingText = 'Non-blocking';
        }
    });

    if (!isOffline()) saveOfflineStore({ policies: items });
    modelPolicies.setData({ ITEMS: items });
}

function openClaimDetail(oEvent) {
    var oItem = oEvent.getParameter('listItem') || oEvent.getSource();
    if (!oItem) return;
    var ctx = oItem.getBindingContext('Claims');
    if (!ctx) return;
    // a copy: the detail can change its total without changing the list
    var claimData = Object.assign({}, ctx.getObject());
    if (!claimData.claimid) return;

    claimData.dateRange = formatDay(claimData.datefrom) + ' to ' + formatDay(claimData.dateto);
    modelClaimsDetail.setData(claimData);

    modelClaimLines.setData({ ITEMS: [] });
    if (isOffline()) {
        showOfflineLines(claimData.claimid);
    } else {
        apigetClaimLines({ parameters: { where: JSON.stringify({ claimid: claimData.claimid }) } });
    }

    modelView.setProperty('/canEditReceipts', canEditReceipts());
    modelView.setProperty('/canDeleteClaim', canDeleteClaim() && !isOffline());
    modelView.setProperty('/sending', false);
    refreshSendAction();
    App.to(pageClaimDetail);
}

// Dates come as 2026-10-14T00:00:00.000Z (or 2026-10-14): show them as 14 Oct 2026.
// Only the first 10 characters are used, so the time zone never moves the day.
function formatDay(value) {
    if (!value) return '';
    var parts = String(value).substring(0, 10).split('-');
    if (parts.length !== 3) return String(value);
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return Number(parts[2]) + ' ' + months[Number(parts[1]) - 1] + ' ' + parts[0];
}

function onClaimLinesDataLoaded(xhr) {
    var response = xhr.responseJSON || [];
    var items = Array.isArray(response) ? response : [];
    var claim = modelClaimsDetail.getData() || {};
    if (claim.claimid) {
        var lines = offlineStore().lines;
        lines[claim.claimid] = items.map(function (l) { return Object.assign({}, l); });
        saveOfflineStore({ lines: lines });
    }
    modelClaimLines.setData({ ITEMS: decorateLines(items) });
    syncClaimTotal(items);
    listLineReceipts(items);
}

// Flags of each line for the buttons in the Receipt column (offline: no receipts, no validation)
function decorateLines(items) {
    var offline = isOffline();
    var canEdit = canEditReceipts() && !offline;
    items.forEach(function (item) {
        item.pendingSync = !!item.pendingSync;
        item.hasReceipt = !!item.receiptid;
        item.canUpload = canEdit && !item.pendingSync;
        item.uploadText = item.hasReceipt ? 'Replace' : 'Upload';
        item.validationText = offline ? 'Needs a connection' : 'Not validated';
        item.validationColor = 10;
        item.hasValidation = false;
        item.canValidate = item.hasReceipt && !offline && canValidateReceipts();
        item.validateText = 'Validate';
        item.canDelete = item.hasReceipt && canEdit;
        item.noReceipt = !item.hasReceipt && !canEdit && !item.pendingSync;
        item.canRemove = canEdit && !item.hasReceipt && !item.pendingSync;
    });
    return items;
}

function onNavBack() {
    App.to(pageClaims);
}

// ---------- Receipts (one per expense line) ----------
var RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
var RECEIPT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

// ---------- User and role (Cockpit role PeopleHubApproverClaim, checked on the server) ----------
function onCurrentUserLoaded(xhr) {
    var u = xhr.responseJSON || {};
    var user = {
        username: u.username || '',
        isRequester: !!u.isRequester,
        isApprover: !!u.isApprover
    };
    modelView.setProperty('/user', user);
    saveOfflineStore({ user: user });
    // lines added offline are sent first, then the claims are loaded
    if (offlineStore().outbox.length) {
        syncOutbox();
    } else {
        loadClaims();
    }
}

// Approvers see all claims; everyone else only their own
function loadClaims() {
    var user = modelView.getProperty('/user') || {};
    var params = { order: JSON.stringify({ datefrom: 'DESC' }) };
    if (!user.isApprover) params.where = JSON.stringify({ createdByPerson: user.username });
    apigetClaims({ parameters: params });
}

function newUuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

// Receipts can be changed while the claim is Draft or Rejected:
// the approver on any claim, a requester only on their own claim
function canEditReceipts() {
    var user = modelView.getProperty('/user') || {};
    var claim = modelClaimsDetail.getData() || {};
    var editable = claim.status === 'Draft' || claim.status === 'Rejected';
    if (!editable) return false;
    if (user.isApprover) return true;
    return !!user.isRequester && claim.createdByPerson === user.username;
}

function getLineFromEvent(oEvent) {
    var ctx = oEvent.getSource().getBindingContext('ClaimLines');
    return ctx ? ctx.getObject() : null;
}

function reloadClaimLines() {
    var claim = modelClaimsDetail.getData() || {};
    if (!claim.claimid) return;
    apigetClaimLines({
        parameters: {
            where: JSON.stringify({ claimid: claim.claimid }),
            order: JSON.stringify({ expensedate: 'ASC' })
        }
    });
}

// Upload: pick a file, store it in peoplehubexpensereceipt, then link it to the line
function onUploadReceipt(oEvent) {
    var line = getLineFromEvent(oEvent);
    if (!line) return;

    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.jpg,.jpeg,.png';
    input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        if (!file) return;
        if (RECEIPT_TYPES.indexOf(file.type) === -1) {
            sap.m.MessageBox.error('Only PDF, JPG or PNG files are allowed.');
            return;
        }
        if (file.size > RECEIPT_MAX_BYTES) {
            sap.m.MessageBox.error('The file is larger than 5 MB.');
            return;
        }
        var reader = new FileReader();
        reader.onload = function () {
            var receiptid = newUuid();
            modelView.setProperty('/pendingReceipt', { lineid: line.lineid, receiptid: receiptid, oldReceiptId: line.receiptid || null });
            apisaveReceipt({
                data: [{
                    receiptid: receiptid,
                    lineid: line.lineid,
                    filename: file.name,
                    mimetype: file.type,
                    content: reader.result
                }]
            });
        };
        reader.readAsDataURL(file);
    });
    input.click();
}

// Delete: remove the receipt row, then clear receiptid on the line
function onDeleteReceipt(oEvent) {
    var line = getLineFromEvent(oEvent);
    if (!line) return;
    sap.m.MessageBox.confirm('Delete the receipt of ' + (line.merchant || 'this line') + '?', {
        onClose: function (action) {
            if (action !== sap.m.MessageBox.Action.OK) return;
            modelView.setProperty('/pendingReceipt', { lineid: line.lineid, receiptid: null });
            apiremoveReceipt({ parameters: { where: JSON.stringify({ lineid: line.lineid }) } });
        }
    });
}

// After PUT (upload) or DELETE: write the new receiptid (or null) on the line
function onReceiptSaved(xhr) {
    var pending = modelView.getProperty('/pendingReceipt');
    if (!pending) return;
    apiupdateClaimLine({
        parameters: { where: JSON.stringify({ lineid: pending.lineid }) },
        data: { receiptid: pending.receiptid }
    });
}

function onClaimLineUpdated(xhr) {
    var pending = modelView.getProperty('/pendingReceipt') || {};
    // Replace: the line now points to the new receipt; delete the old one (and its validation with it)
    if (pending.receiptid && pending.oldReceiptId) {
        apideleteOldReceipt({ parameters: { where: JSON.stringify({ receiptid: pending.oldReceiptId }) } });
        return;
    }
    modelView.setProperty('/pendingReceipt', null);
    sap.m.MessageToast.show(pending.receiptid ? 'Receipt uploaded' : 'Receipt deleted');
    reloadClaimLines();
}

function onReceiptError(xhr) {
    modelView.setProperty('/pendingReceipt', null);
    var msg = (xhr && xhr.responseJSON && (xhr.responseJSON.message || xhr.responseJSON.error)) || 'The receipt could not be saved.';
    sap.m.MessageBox.error(msg);
}

// Preview: open the receipt from its URL (PDF in sap.m.PDFViewer, photo in sap.m.Image)
function onPreviewReceipt(oEvent) {
    var line = getLineFromEvent(oEvent);
    if (!line || !line.receiptid) return;
    openReceiptPreview(line.receiptid, line.receiptFile || 'Receipt', line.receiptMime);
}

// ---------- Expense lines (add / remove) ----------
var LINE_CATEGORIES = ['Meals', 'Hotel', 'Transport', 'Mileage', 'Other'];
var LINE_CURRENCIES = ['EUR', 'GBP', 'USD', 'CHF'];

function toOptions(list) {
    return list.map(function (v) { return { key: v, text: v }; });
}

function parseNumber(v) {
    return parseFloat(String(v === undefined || v === null ? '' : v).replace(',', '.'));
}

function onAddLine() {
    var claim = modelClaimsDetail.getData() || {};
    modelView.setProperty('/lineOptions', {
        categories: toOptions(LINE_CATEGORIES),
        currencies: toOptions(LINE_CURRENCIES)
    });
    modelView.setProperty('/newLine', {
        expensedate: String(claim.datefrom || '').substring(0, 10),
        category: 'Meals',
        merchant: '',
        description: '',
        amount: '',
        currency: 'EUR',
        rate: '1',
        distancekm: ''
    });
    dlgAddLine.open();
}

function onSaveLine() {
    var l = modelView.getProperty('/newLine') || {};
    var claim = modelClaimsDetail.getData() || {};
    var amount = parseNumber(l.amount);
    var isEur = l.currency === 'EUR';
    var rate = isEur ? 1 : parseNumber(l.rate);

    if (!l.expensedate || !l.category) {
        sap.m.MessageBox.error('Date and category are required.');
        return;
    }
    if (!(amount > 0)) {
        sap.m.MessageBox.error('Enter an amount greater than 0.');
        return;
    }
    if (!(rate > 0)) {
        sap.m.MessageBox.error('Enter the exchange rate to EUR.');
        return;
    }

    var row = {
        lineid: newUuid(),
        claimid: claim.claimid,
        expensedate: l.expensedate,
        category: l.category,
        merchant: l.merchant || null,
        description: l.description || null,
        amount: amount,
        currency: l.currency,
        rate: isEur ? null : rate,
        ratedate: isEur ? null : l.expensedate,
        amounteur: Math.round(amount * rate * 100) / 100,
        distancekm: l.category === 'Mileage' && l.distancekm ? parseNumber(l.distancekm) : null,
        receiptid: null,
        policyflags: null
    };

    if (isOffline()) {
        queueLine(row);
        return;
    }
    apiaddClaimLine({ data: [row] });
}

function onLineAdded(xhr) {
    if (modelView.getProperty('/syncing')) {
        onOutboxSent();
        return;
    }
    dlgAddLine.close();
    sap.m.MessageToast.show('Line added');
    reloadClaimLines();
}

// A line can only be removed when it has no receipt (delete the receipt first)
function onRemoveLine(oEvent) {
    var line = getLineFromEvent(oEvent);
    if (!line) return;
    sap.m.MessageBox.confirm('Remove the line ' + (line.merchant || line.category) + '?', {
        onClose: function (action) {
            if (action !== sap.m.MessageBox.Action.OK) return;
            apiremoveClaimLine({ parameters: { where: JSON.stringify({ lineid: line.lineid }) } });
        }
    });
}

function onLineRemoved(xhr) {
    sap.m.MessageToast.show('Line removed');
    reloadClaimLines();
}

function onLineError(xhr) {
    var msg = (xhr && xhr.responseJSON && (xhr.responseJSON.message || xhr.responseJSON.error)) || 'The expense line could not be saved.';
    if (modelView.getProperty('/syncing')) {
        modelView.setProperty('/syncing', false);
        msg = 'The lines you added offline could not be sent: ' + msg + ' They stay on this device; they are sent again next time you open the app online.';
    }
    sap.m.MessageBox.error(msg);
}

// Keep the claim total (EUR) equal to the sum of its lines
function syncClaimTotal(items) {
    var claim = modelClaimsDetail.getData() || {};
    if (!claim.claimid || !canEditReceipts()) return;
    var total = Math.round(items.reduce(function (s, i) { return s + Number(i.amounteur || 0); }, 0) * 100) / 100;
    if (Number(claim.totaleur || 0) === total) return;
    modelClaimsDetail.setProperty('/totaleur', total);
    apiupdateClaim({
        parameters: { where: JSON.stringify({ claimid: claim.claimid }) },
        data: { totaleur: total }
    });
}

function onClaimUpdated(xhr) {
    loadClaims();
}

// ---------- New claim (every user can create one; it starts as Draft) ----------
function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function onNewClaim() {
    modelView.setProperty('/newClaim', { title: '', purpose: '', datefrom: todayKey(), dateto: todayKey() });
    dlgNewClaim.open();
}

function onCreateClaim() {
    var c = modelView.getProperty('/newClaim') || {};
    var user = modelView.getProperty('/user') || {};
    if (!String(c.title || '').trim()) {
        sap.m.MessageBox.error('Enter a title for the claim.');
        return;
    }
    if (!c.datefrom || !c.dateto) {
        sap.m.MessageBox.error('Enter the date from and date to.');
        return;
    }
    if (c.dateto < c.datefrom) {
        sap.m.MessageBox.error('Date to cannot be before date from.');
        return;
    }

    var claim = {
        claimid: newUuid(),
        title: String(c.title).trim(),
        purpose: c.purpose || null,
        datefrom: c.datefrom,
        dateto: c.dateto,
        status: 'Draft',
        totaleur: 0,
        createdByPerson: user.username,
        submittedat: null,
        approver: null,
        decidedat: null,
        rejectionreason: null
    };
    modelView.setProperty('/pendingClaim', claim);
    apicreateClaim({ data: [claim] });
}

// Open the new claim straight away so lines and receipts can be added
function onClaimCreated(xhr) {
    var claim = modelView.getProperty('/pendingClaim');
    modelView.setProperty('/pendingClaim', null);
    dlgNewClaim.close();
    sap.m.MessageToast.show('Claim created');
    loadClaims();
    if (!claim) return;

    claim.dateRange = formatDay(claim.datefrom) + ' to ' + formatDay(claim.dateto);
    modelClaimsDetail.setData(claim);
    modelClaimLines.setData({ ITEMS: [] });
    modelView.setProperty('/canEditReceipts', canEditReceipts());
    modelView.setProperty('/canDeleteClaim', canDeleteClaim());
    modelView.setProperty('/sending', false);
    refreshSendAction();
    App.to(pageClaimDetail);
}

function onClaimCreateError(xhr) {
    modelView.setProperty('/pendingClaim', null);
    var msg = (xhr && xhr.responseJSON && (xhr.responseJSON.message || xhr.responseJSON.error)) || 'The claim could not be created.';
    sap.m.MessageBox.error(msg);
}

// ---------- Delete claim (Draft only; deletes receipts, lines, then the claim) ----------
function canDeleteClaim() {
    var user = modelView.getProperty('/user') || {};
    var claim = modelClaimsDetail.getData() || {};
    if (claim.status !== 'Draft') return false;
    return !!user.isApprover || claim.createdByPerson === user.username;
}

function onDeleteClaim() {
    var claim = modelClaimsDetail.getData() || {};
    if (!canDeleteClaim()) {
        sap.m.MessageBox.error('Only Draft claims can be deleted.');
        return;
    }
    sap.m.MessageBox.confirm('Delete the claim "' + claim.title + '" with all its lines and receipts? This cannot be undone.', {
        onClose: function (action) {
            if (action !== sap.m.MessageBox.Action.OK) return;
            var lines = (modelClaimLines.getData() || {}).ITEMS || [];
            var lineIds = lines.map(function (l) { return l.lineid; });
            if (lineIds.length === 0) {
                deleteClaimHeader();
            } else {
                apideleteClaimReceipts({ parameters: { where: JSON.stringify({ lineid: 'In(' + JSON.stringify(lineIds) + ')' }) } });
            }
        }
    });
}

function onClaimReceiptsDeleted(xhr) {
    var claim = modelClaimsDetail.getData() || {};
    apideleteClaimLines({ parameters: { where: JSON.stringify({ claimid: claim.claimid }) } });
}

function onClaimLinesDeleted(xhr) {
    deleteClaimHeader();
}

function deleteClaimHeader() {
    var claim = modelClaimsDetail.getData() || {};
    apideleteClaim({ parameters: { where: JSON.stringify({ claimid: claim.claimid }) } });
}

function onClaimDeleted(xhr) {
    sap.m.MessageToast.show('Claim deleted');
    modelClaimsDetail.setData({});
    modelClaimLines.setData({ ITEMS: [] });
    loadClaims();
    App.to(pageClaims);
}

function onDeleteClaimError(xhr) {
    var msg = (xhr && xhr.responseJSON && (xhr.responseJSON.message || xhr.responseJSON.error)) || 'The claim could not be deleted.';
    sap.m.MessageBox.error(msg);
    reloadClaimLines();
}

// ---------- Receipt replace + AI validation ----------
// Date and time as "14 Oct 2026, 14:06" (local time); the day itself comes from formatDay.
function formatDateTime(value) {
    var t = value ? new Date(value) : null;
    if (!t || isNaN(t.getTime())) return '';
    var hh = ('0' + t.getHours()).slice(-2), mm = ('0' + t.getMinutes()).slice(-2);
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return t.getDate() + ' ' + months[t.getMonth()] + ' ' + t.getFullYear() + ', ' + hh + ':' + mm;
}
var VALIDATION_LOOK = {
    pass: { text: 'Passed', color: 8, strip: 'Success' },
    warning: { text: 'Warning', color: 1, strip: 'Warning' },
    fail: { text: 'Failed', color: 3, strip: 'Error' }
};

function onOldReceiptDeleted(xhr) {
    modelView.setProperty('/pendingReceipt', null);
    sap.m.MessageToast.show('Receipt replaced');
    reloadClaimLines();
}

// The owner of the claim or the approver can validate (also on Submitted claims)
function canValidateReceipts() {
    var user = modelView.getProperty('/user') || {};
    var claim = modelClaimsDetail.getData() || {};
    return !!user.isApprover || claim.createdByPerson === user.username;
}

// Load file name + validation of every receipt of these lines (without the file content)
function listLineReceipts(items) {
    var ids = items.filter(function (i) { return i.hasReceipt; }).map(function (i) { return i.lineid; });
    if (!ids.length) return;
    apilistReceipts({
        parameters: {
            where: JSON.stringify({ lineid: 'In(' + JSON.stringify(ids) + ')' }),
            select: 'receiptid,lineid,filename,mimetype,validationstatus,validationresult,validatedat'
        }
    });
}

function onReceiptsListed(xhr) {
    var receipts = xhr.responseJSON || [];
    var byLine = {};
    receipts.forEach(function (r) { byLine[String(r.lineid).toUpperCase()] = r; });
    var data = modelClaimLines.getData() || {};
    (data.ITEMS || []).forEach(function (item) {
        var r = byLine[String(item.lineid).toUpperCase()];
        if (!r || String(r.receiptid).toUpperCase() !== String(item.receiptid).toUpperCase()) return;
        var look = VALIDATION_LOOK[r.validationstatus];
        item.receiptFile = r.filename;
        item.receiptMime = r.mimetype;
        item.hasValidation = !!look;
        item.validationText = look ? look.text : 'Not validated';
        item.validationColor = look ? look.color : 10;
        item.validateText = look ? 'Revalidate' : 'Validate';
        item.validationResult = r.validationresult ? JSON.parse(r.validationresult) : null;
    });
    modelClaimLines.refresh(true);
}

function onValidateReceipt(oEvent) {
    var line = getLineFromEvent(oEvent);
    if (line) validateLine(line.lineid);
}

function validateLine(lineid) {
    modelView.setProperty('/validatingLineId', lineid);
    sap.ui.core.BusyIndicator.show(0);
    sap.m.MessageToast.show('The AI is reading the receipt…');
    apivalidateReceipt({ data: { lineid: lineid } });
}

function onReceiptValidated(xhr) {
    sap.ui.core.BusyIndicator.hide();
    var res = xhr.responseJSON || {};
    var look = VALIDATION_LOOK[res.status] || VALIDATION_LOOK.fail;
    sap.m.MessageToast.show('Validation: ' + look.text);
    reloadClaimLines();
    showValidation(res, res.lineid);
}

function onValidationError(xhr) {
    sap.ui.core.BusyIndicator.hide();
    var msg = (xhr && xhr.responseJSON && (xhr.responseJSON.error || xhr.responseJSON.message)) || 'The receipt could not be validated.';
    sap.m.MessageBox.error(msg);
}

function onShowValidation(oEvent) {
    var line = getLineFromEvent(oEvent);
    if (line && line.validationResult) showValidation(line.validationResult, line.lineid);
}

// Prepare the result for the dialog (View>/validation) and open it
function showValidation(res, lineid) {
    var look = VALIDATION_LOOK[res.status] || VALIDATION_LOOK.fail;
    var x = res.extraction || {};
    var lines = (modelClaimLines.getData() || {}).ITEMS || [];
    var line = lines.filter(function (l) { return String(l.lineid).toUpperCase() === String(lineid).toUpperCase(); })[0] || {};
    modelView.setProperty('/validation', {
        lineid: lineid,
        title: 'Validation: ' + (line.merchant || line.category || 'receipt'),
        summary: look.text + ' – ' + (res.summary || ''),
        stripType: look.strip,
        vendor: x.vendor || '-',
        date: formatDay(x.date) || '-',
        totalText: x.total ? (x.total + ' ' + (x.currency || '')) : '-',
        similarityText: res.similarity !== null && res.similarity !== undefined ? Math.round(res.similarity * 100) + ' %' : '-',
        checks: (res.checks || []).map(function (c) {
            var l = VALIDATION_LOOK[c.status] || VALIDATION_LOOK.fail;
            return { label: c.label, expected: c.expected, actual: c.actual, message: c.message, statusText: l.text, color: l.color };
        }),
        redFlags: (res.redFlags || []).map(function (t) { return { text: t }; }),
        hasRedFlags: (res.redFlags || []).length > 0,
        validatedText: res.validatedAt ? 'Validated ' + formatDateTime(res.validatedAt) + (res.validatedBy ? ' by ' + res.validatedBy : '') : '',
        canValidate: canValidateReceipts()
    });
    dlgValidation.open();
}

function onRevalidateFromDialog() {
    var lineid = modelView.getProperty('/validation/lineid');
    dlgValidation.close();
    if (lineid) validateLine(lineid);
}

// The receipt file as a real URL with its own Content-Type (a blob: URL does not work in sap.m.PDFViewer)
function receiptUrl(receiptid) {
    return '/api/serverscript/PeopleHubReceiptFileApi/?receiptid=' + encodeURIComponent(receiptid);
}

function openReceiptPreview(receiptid, filename, mimetype) {
    var url = receiptUrl(receiptid);
    var isPdf = mimetype ? mimetype === 'application/pdf' : /\.pdf$/i.test(filename || '');
    if (isPdf) {
        // Create a new viewer every time and use its own open(); never put it inside your own Dialog
        var viewer = new sap.m.PDFViewer({
            source: url,
            title: filename,
            isTrustedSource: true,
            showDownloadButton: true,
            width: '100%',
            height: '80vh'
        });
        viewer.open();
        return;
    }
    var dialog = new sap.m.Dialog({
        title: filename,
        contentWidth: '40rem',
        resizable: true,
        content: [new sap.m.Image({ src: url, width: '100%' })],
        endButton: new sap.m.Button({ text: 'Close', press: function () { dialog.close(); } }),
        afterClose: function () { dialog.destroy(); }
    });
    dialog.open();
}

function refreshSendAction() {
    var user = modelView.getProperty('/user') || {};
    var claim = modelClaimsDetail.getData() || {};
    var mine = !!user.isApprover || claim.createdByPerson === user.username;
    var open = claim.status === 'Draft' || claim.status === 'Rejected';
    modelView.setProperty('/showSendClaim', mine);
    modelView.setProperty('/canSendClaim', mine && open && !modelView.getProperty('/sending') && !isOffline());
}

function onSendForApproval() {
    if (!modelView.getProperty('/canSendClaim')) return;
    var claim = modelClaimsDetail.getData() || {};
    var lines = (modelClaimLines.getData() || {}).ITEMS || [];
    if (!lines.length) {
        sap.m.MessageBox.error('Add at least one expense line before you send the claim.');
        return;
    }
    var notValidated = lines.filter(function (l) { return l.hasReceipt && !l.hasValidation; }).length;
    var textLines = [];
    textLines.push('Send "' + claim.title + '" (' + lines.length + ' line(s), ' + Number(claim.totaleur || 0).toFixed(2) + ' EUR) for approval?');
    textLines.push('');
    textLines.push('After sending, the claim is locked and you can send it only once.');
    if (notValidated) {
        textLines.push('');
        textLines.push(notValidated + ' receipt(s) are not validated yet.');
    }
    var text = textLines.join(String.fromCharCode(10));
    sap.m.MessageBox.confirm(text, {
        title: 'Send for approval',
        onClose: function (action) {
            if (action !== sap.m.MessageBox.Action.OK) return;
            modelView.setProperty('/sending', true);
            modelView.setProperty('/canSendClaim', false);
            sap.ui.core.BusyIndicator.show(0);
            apisendForApproval({ data: { claimid: claim.claimid } });
        }
    });
}

function onClaimSent(xhr) {
    sap.ui.core.BusyIndicator.hide();
    var res = xhr.responseJSON || {};
    modelClaimsDetail.setProperty('/status', res.status || 'Submitted');
    modelClaimsDetail.setProperty('/submittedat', res.submittedat || null);
    if (res.totaleur !== undefined) modelClaimsDetail.setProperty('/totaleur', res.totaleur);
    modelView.setProperty('/canEditReceipts', canEditReceipts());
    modelView.setProperty('/canDeleteClaim', canDeleteClaim());
    refreshSendAction();
    reloadClaimLines();
    loadClaims();
    sap.m.MessageToast.show('Claim sent for approval');
}

function onSendError(xhr) {
    sap.ui.core.BusyIndicator.hide();
    var res = (xhr && xhr.responseJSON) || {};
    if (xhr && xhr.status === 409 && res.status) {
        modelClaimsDetail.setProperty('/status', res.status);
        modelView.setProperty('/canEditReceipts', canEditReceipts());
        modelView.setProperty('/canDeleteClaim', canDeleteClaim());
        loadClaims();
    } else {
        modelView.setProperty('/sending', false);
    }
    refreshSendAction();
    sap.m.MessageBox.error(res.error || res.message || 'The claim could not be sent for approval.');
}

// ---------- Offline (exercise 2.3) ----------
// The model OfflineStore is saved in the browser (IndexedDB, per user) and loaded from there at start-up:
// { user, policies, claims, lines: { <claimid>: [lines] }, outbox: [new lines not sent yet], savedAt }
// Offline you can see your claims and lines and add expense lines; receipts, validation, new claims,
// delete and send for approval need a connection. The outbox is sent when the connection is back.

// The launchpad knows when it is offline (AppCache); outside a launchpad the browser tells us
function isOffline() {
    if (typeof AppCache !== 'undefined' && AppCache.isOffline) return true;
    return navigator.onLine === false;
}

function offlineStore() {
    var s = modelOfflineStore.getData();
    if (!s || Array.isArray(s)) s = {};
    if (!Array.isArray(s.claims)) s.claims = [];
    if (!Array.isArray(s.policies)) s.policies = [];
    if (!Array.isArray(s.outbox)) s.outbox = [];
    if (!s.lines || typeof s.lines !== 'object') s.lines = {};
    return s;
}

// Change some parts of the store and save it on the device
function saveOfflineStore(changes) {
    var s = offlineStore();
    Object.keys(changes).forEach(function (key) { s[key] = changes[key]; });
    s.savedAt = new Date().toISOString();
    modelOfflineStore.setData(s);
    setCacheOfflineStore();
    refreshOfflineState();
}

// The banner on both pages
function refreshOfflineState() {
    var offline = isOffline();
    var waiting = offlineStore().outbox.length;
    var text = '';
    if (offline) {
        text = 'You are offline. You can see your claims and add expense lines: they are sent when you are back online.';
        if (waiting) text += ' ' + waiting + ' line(s) waiting to be sent.';
    } else if (waiting) {
        text = waiting + ' expense line(s) waiting to be sent.';
    }
    modelView.setProperty('/offline', offline);
    modelView.setProperty('/showOfflineStrip', offline || waiting > 0);
    modelView.setProperty('/offlineText', text);
    modelView.setProperty('/offlineType', offline ? 'Warning' : 'Information');
}

// Start-up: called when OfflineStore has been read from the device (event cacheInitLoadFinished),
// or after 2 seconds if the device does not answer
function onOfflineStoreLoaded() {
    startApp();
}

function startApp() {
    if (modelView.getProperty('/started')) return;
    modelView.setProperty('/started', true);
    refreshOfflineState();
    if (isOffline()) {
        showOfflineData();
        return;
    }
    apiloadCurrentUser();
    apigetPolicies();
}

// Offline start: show what was saved on this device
function showOfflineData() {
    var s = offlineStore();
    if (s.user) modelView.setProperty('/user', s.user);
    onPoliciesDataLoaded({ responseJSON: s.policies });
    onClaimsDataLoaded({ responseJSON: s.claims });
    if (!s.claims.length) {
        sap.m.MessageToast.show('No claims saved on this device yet. Open the app once while you are online.');
    }
}

function onWentOffline() {
    refreshOfflineState();
    refreshDetailActions();
    sap.m.MessageToast.show('You are offline');
}

function onBackOnline() {
    // give the launchpad a moment to notice the connection too
    setTimeout(function () {
        refreshOfflineState();
        if (!modelView.getProperty('/started')) return;
        sap.m.MessageToast.show('You are back online');
        if (!modelView.getProperty('/user/username')) {
            apiloadCurrentUser();
            apigetPolicies();
            return;
        }
        refreshDetailActions();
        if (offlineStore().outbox.length) {
            syncOutbox();
        } else {
            loadClaims();
        }
    }, 500);
}

// Lines of a claim from the device: the saved lines plus the new ones that are waiting
function showOfflineLines(claimid) {
    var s = offlineStore();
    var saved = s.lines[claimid];
    var waiting = s.outbox
        .filter(function (l) { return l.claimid === claimid; })
        .map(function (l) { return Object.assign({ pendingSync: true }, l); });
    if (!saved) {
        sap.m.MessageToast.show('The lines of this claim are not saved on this device. Lines you add now are sent when you are back online.');
    }
    var items = (saved || []).map(function (l) { return Object.assign({}, l); }).concat(waiting);
    modelClaimLines.setData({ ITEMS: decorateLines(items) });
    setLocalTotal(items);
}

// Total shown in the detail while offline (the server total is updated when the lines are sent)
function setLocalTotal(items) {
    var total = Math.round(items.reduce(function (sum, i) { return sum + Number(i.amounteur || 0); }, 0) * 100) / 100;
    modelClaimsDetail.setProperty('/totaleur', total);
}

// Buttons of the detail page: delete, send, receipts and validation only online
function refreshDetailActions() {
    var claim = modelClaimsDetail.getData() || {};
    if (!claim.claimid) return;
    modelView.setProperty('/canDeleteClaim', canDeleteClaim() && !isOffline());
    refreshSendAction();
    var items = (modelClaimLines.getData() || {}).ITEMS || [];
    modelClaimLines.setData({ ITEMS: decorateLines(items) });
}

// Offline: keep the new line on the device and show it straight away
function queueLine(row) {
    var s = offlineStore();
    s.outbox.push(row);
    saveOfflineStore({ outbox: s.outbox });
    dlgAddLine.close();
    var items = ((modelClaimLines.getData() || {}).ITEMS || []).concat([Object.assign({ pendingSync: true }, row)]);
    modelClaimLines.setData({ ITEMS: decorateLines(items) });
    setLocalTotal(items);
    sap.m.MessageToast.show('Line saved on this device. It is sent when you are back online.');
}

// Back online: send all waiting lines in one call (the success comes back in onLineAdded)
function syncOutbox() {
    var outbox = offlineStore().outbox;
    if (!outbox.length || modelView.getProperty('/syncing')) return;
    modelView.setProperty('/syncing', true);
    apiaddClaimLine({ data: outbox.slice() });
}

function onOutboxSent() {
    var s = offlineStore();
    var sent = s.outbox;
    // claim total in the table = the saved total + the lines that were waiting
    var added = {};
    sent.forEach(function (l) { added[l.claimid] = (added[l.claimid] || 0) + Number(l.amounteur || 0); });
    Object.keys(added).forEach(function (claimid) {
        var saved = s.claims.find(function (c) { return c.claimid === claimid; }) || {};
        var total = Math.round((Number(saved.totaleur || 0) + added[claimid]) * 100) / 100;
        apiupdateClaim({
            parameters: { where: JSON.stringify({ claimid: claimid }) },
            data: { totaleur: total }
        });
    });
    modelView.setProperty('/syncing', false);
    saveOfflineStore({ outbox: [] });
    sap.m.MessageToast.show(sent.length + ' expense line(s) sent');
    loadClaims();
    var claim = modelClaimsDetail.getData() || {};
    if (claim.claimid && App.getCurrentPage() === pageClaimDetail) reloadClaimLines();
}

initData();