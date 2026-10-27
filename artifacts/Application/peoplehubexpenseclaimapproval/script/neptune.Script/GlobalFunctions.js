// App peoplehubexpenseclaimapproval: the read-only claim page inside the approver's task (My Approvals).
// The approver decides with the Approve / Reject buttons of My Approvals; this app has no decision buttons.
// Start parameters from the user task: { claimid, recommendation, summary }.

var VALIDATION_LOOK = {
    pass: { text: 'Passed', color: 8, strip: 'Success' },
    warning: { text: 'Warning', color: 1, strip: 'Warning' },
    fail: { text: 'Failed', color: 3, strip: 'Error' }
};
var RECOMMENDATION_LOOK = {
    approve: { text: 'AI recommends: Approve', strip: 'Success', color: 8 },
    review: { text: 'AI recommends: Review', strip: 'Warning', color: 1 },
    reject: { text: 'AI recommends: Reject', strip: 'Error', color: 3 }
};

function initData() {
    modelStart.setData({});
    modelDetail.setData({});
    modelLines.setData({ ITEMS: [] });
    modelView.setData({ started: false, recommendation: RECOMMENDATION_LOOK.review, validation: {} });
}

// Dates as "14 Oct 2026"; date and time as "5 Oct 2026, 14:30" (local time)
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(v) {
    var d = String(v || '').substring(0, 10).split('-');
    if (d.length !== 3) return v ? String(v) : '-';
    return Number(d[2]) + ' ' + MONTHS[Number(d[1]) - 1] + ' ' + d[0];
}

function fmtDateTime(v) {
    var t = v ? new Date(v) : null;
    if (!t || isNaN(t.getTime())) return '-';
    var hh = ('0' + t.getHours()).slice(-2), mm = ('0' + t.getMinutes()).slice(-2);
    return t.getDate() + ' ' + MONTHS[t.getMonth()] + ' ' + t.getFullYear() + ', ' + hh + ':' + mm;
}

// Load the claim of the task. Without a claimid (test run outside My Approvals) the last Submitted claim is shown.
function loadClaim(start) {
    start = start || {};
    modelView.setProperty('/started', true);
    modelStart.setData(start);
    modelView.setProperty('/recommendation', RECOMMENDATION_LOOK[start.recommendation] || RECOMMENDATION_LOOK.review);
    msgLoadError.setVisible(false);
    if (start.claimid) {
        apigetClaim({ parameters: { where: JSON.stringify({ claimid: start.claimid }) } });
    } else {
        apigetClaim({ parameters: { where: JSON.stringify({ status: 'Submitted' }), order: JSON.stringify({ submittedat: 'DESC' }), take: 1 } });
    }
}

function onClaimLoaded(xhr) {
    var rows = xhr.responseJSON || [];
    var claim = Array.isArray(rows) ? rows[0] : null;
    if (!claim) {
        showLoadError('The expense claim was not found.');
        return;
    }
    claim.periodText = fmtDate(claim.datefrom) + ' to ' + fmtDate(claim.dateto);
    claim.submittedText = fmtDateTime(claim.submittedat);
    modelDetail.setData(claim);
    if (!modelStart.getProperty('/claimid')) modelStart.setProperty('/claimid', claim.claimid);
    apigetClaimLines({
        parameters: {
            where: JSON.stringify({ claimid: claim.claimid }),
            order: JSON.stringify({ expensedate: 'ASC' })
        }
    });
}

function onClaimLinesLoaded(xhr) {
    var rows = xhr.responseJSON || [];
    var items = Array.isArray(rows) ? rows : [];
    items.forEach(function (item) {
        item.dateText = fmtDate(item.expensedate);
        item.hasReceipt = !!item.receiptid;
        item.hasValidation = false;
        item.validationText = item.hasReceipt ? 'Not validated' : 'No receipt';
        item.validationColor = item.hasReceipt ? 10 : 9;
    });
    modelLines.setData({ ITEMS: items });
    modelDetail.setProperty('/lineCountText', 'Expense lines (' + items.length + ')');

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
    var data = modelLines.getData() || {};
    (data.ITEMS || []).forEach(function (item) {
        var r = byLine[String(item.lineid).toUpperCase()];
        if (!r || String(r.receiptid).toUpperCase() !== String(item.receiptid).toUpperCase()) return;
        var look = VALIDATION_LOOK[r.validationstatus];
        item.receiptFile = r.filename;
        item.receiptMime = r.mimetype;
        item.hasValidation = !!look;
        item.validationText = look ? look.text : 'Not validated';
        item.validationColor = look ? look.color : 10;
        item.validationResult = r.validationresult ? JSON.parse(r.validationresult) : null;
    });
    modelLines.refresh(true);
}

function showLoadError(text) {
    msgLoadError.setText(text);
    msgLoadError.setVisible(true);
}

function onLoadError(xhr) {
    showLoadError((xhr && xhr.responseJSON && (xhr.responseJSON.error || xhr.responseJSON.message)) || 'The expense claim could not be loaded.');
}

function getLineFromEvent(oEvent) {
    var ctx = oEvent.getSource().getBindingContext('Lines');
    return ctx ? ctx.getObject() : null;
}

// ---------- Validation result (read-only) ----------
function onShowValidation(oEvent) {
    var line = getLineFromEvent(oEvent);
    if (line && line.validationResult) showValidation(line.validationResult, line);
}

function showValidation(res, line) {
    var look = VALIDATION_LOOK[res.status] || VALIDATION_LOOK.fail;
    var x = res.extraction || {};
    modelView.setProperty('/validation', {
        lineid: line.lineid,
        title: 'Validation: ' + (line.merchant || line.category || 'receipt'),
        summary: look.text + ' – ' + (res.summary || ''),
        stripType: look.strip,
        vendor: x.vendor || '-',
        date: fmtDate(x.date),
        totalText: x.total ? (x.total + ' ' + (x.currency || '')) : '-',
        similarityText: res.similarity !== null && res.similarity !== undefined ? Math.round(res.similarity * 100) + ' %' : '-',
        checks: (res.checks || []).map(function (c) {
            var l = VALIDATION_LOOK[c.status] || VALIDATION_LOOK.fail;
            return { label: c.label, expected: c.expected, actual: c.actual, message: c.message, statusText: l.text, color: l.color };
        }),
        redFlags: (res.redFlags || []).map(function (t) { return { text: t }; }),
        hasRedFlags: (res.redFlags || []).length > 0,
        validatedText: res.validatedAt ? 'Validated ' + fmtDateTime(res.validatedAt) + (res.validatedBy ? ' by ' + res.validatedBy : '') : '',
        canValidate: false
    });
    dlgValidation.open();
}

// ---------- Receipt preview ----------
function onPreviewReceipt(oEvent) {
    var line = getLineFromEvent(oEvent);
    if (!line || !line.receiptid) return;
    openReceiptPreview(line.receiptid, line.receiptFile || 'Receipt', line.receiptMime);
}

// The receipt file as a real URL with its own Content-Type (a blob: URL does not work in sap.m.PDFViewer)
function receiptUrl(receiptid) {
    return '/api/serverscript/peoplehubreceiptfileapi/?receiptid=' + encodeURIComponent(receiptid);
}

function openReceiptPreview(receiptid, filename, mimetype) {
    var url = receiptUrl(receiptid);
    var isPdf = mimetype ? mimetype === 'application/pdf' : /\.pdf$/i.test(filename || '');
    if (isPdf) {
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

// ---------- Start ----------
initData();

// Inside My Approvals: the task passes its start parameters
neptune.Shell.attachBeforeDisplay(function (data) {
    loadClaim(data || {});
});

// Run directly from App Designer (test): show the last Submitted claim
setTimeout(function () {
    if (!modelView.getProperty('/started')) {
        loadClaim({ recommendation: 'review', summary: 'Test run outside My Approvals: this is the last submitted claim.' });
    }
}, 800);
