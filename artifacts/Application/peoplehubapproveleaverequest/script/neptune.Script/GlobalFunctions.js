// ===== Helpers =====

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

function formatIsoDate(iso) {
  // iso: "YYYY-MM-DD"
  if (!iso || iso.length < 10) { return iso || ''; }
  var y = iso.substring(0, 4);
  var m = iso.substring(5, 7);
  var d = iso.substring(8, 10);
  return d + '.' + m + '.' + y;
}

function isoToNum(iso) {
  if (!iso) { return 0; }
  return parseInt(iso.replace(/-/g, ''), 10);
}

function formatSapDate(sapDate) {
  // sapDate: "YYYYMMDD" (string or number)
  if (sapDate === null || sapDate === undefined || sapDate === '') { return ''; }
  var s = String(sapDate);
  while (s.length < 8) { s = '0' + s; }
  var y = s.substring(0, 4);
  var m = s.substring(4, 6);
  var d = s.substring(6, 8);
  return d + '.' + m + '.' + y;
}

function sapDateToNum(sapDate) {
  if (sapDate === null || sapDate === undefined || sapDate === '') { return 0; }
  var s = String(sapDate);
  while (s.length < 8) { s = '0' + s; }
  return parseInt(s, 10);
}

function getStatusText(status) {
  if (status === 'PENDING') { return 'Pending approval'; }
  if (status === 'APPROVED') { return 'Approved'; }
  if (status === 'REJECTED') { return 'Rejected'; }
  if (status === 'CANCELLED') { return 'Cancelled'; }
  return status || '';
}

function getStatusScheme(status) {
  if (status === 'PENDING') { return 1; }
  if (status === 'APPROVED') { return 8; }
  if (status === 'REJECTED') { return 3; }
  if (status === 'CANCELLED') { return 10; }
  return 1;
}

function decoratePeriod(startIso, endIso) {
  return formatIsoDate(startIso) + ' - ' + formatIsoDate(endIso);
}

function decorateRequestRow(row, username) {
  row.PERIOD_TEXT = decoratePeriod(row.START_DATE, row.END_DATE);
  row.STATUS_TEXT = getStatusText(row.STATUS);
  row.STATUS_SCHEME = getStatusScheme(row.STATUS);
  row.ISOWN = (username && row.createdBy === username) ? true : false;
  return row;
}

// ===== Init =====

function initData() {
  modelView.setData({
    username: '',
    isEmployee: false,
    isManager: false,
    mapped: false,
    PERNR: '',
    EMPLOYEE_NAME: '',
    ORG_TEXT: '',
    POS_TEXT: '',
    MANAGER_PERNR: '',
    MANAGER_NAME: '',
    message: '',
    showNoAccess: false,
    pendingAction: 'list'
  });

  modelList.setData({
    ITEMS: [],
    statusFilter: 'PENDING',
    count: 0,
    busy: false
  });

  modelDetail.setData({
    id: '',
    PERNR: '',
    EMPLOYEE_NAME: '',
    MANAGER_PERNR: '',
    AWART: '',
    TYPE_TEXT: '',
    START_DATE: '',
    END_DATE: '',
    PERIOD_TEXT: '',
    WORKING_DAYS: 0,
    COMMENT: '',
    STATUS: '',
    STATUS_TEXT: '',
    STATUS_SCHEME: 1,
    DECISION_COMMENT: '',
    DECIDED_BY: '',
    DECIDED_AT: null,
    CREATED_AT_APP: null,
    SOURCE: '',
    createdBy: '',
    employee: {
      ORG_TEXT: '',
      POS_TEXT: '',
      MANAGER_TEXT: '',
      hasData: false,
      noData: false
    },
    balance: {
      ITEMS: []
    },
    booked: {
      ITEMS: [],
      SUM_TEXT: 'Total working days booked: 0'
    },
    absences: {
      ITEMS: []
    }
  });

  apigetPeopleHubLeaveRequestUserApi();
}

// ===== User API =====

function onUserApiSuccess(xhr) {
  var response = xhr.responseJSON;
  var isManager = response.isManager === true;
  modelView.setData({
    username: response.username || '',
    isEmployee: response.isEmployee === true,
    isManager: isManager,
    mapped: response.mapped === true,
    PERNR: response.PERNR || '',
    EMPLOYEE_NAME: response.EMPLOYEE_NAME || '',
    ORG_TEXT: response.ORG_TEXT || '',
    POS_TEXT: response.POS_TEXT || '',
    MANAGER_PERNR: response.MANAGER_PERNR || '',
    MANAGER_NAME: response.MANAGER_NAME || '',
    message: response.message || '',
    showNoAccess: !isManager,
    pendingAction: 'list'
  });

  if (isManager) {
    loadRequests();
  }
}

function onUserApiError(xhr) {
  modelView.setProperty('/isManager', false);
  modelView.setProperty('/showNoAccess', true);
}

// ===== List page =====

function loadRequests() {
  var statusFilter = modelList.getProperty('/statusFilter') || 'PENDING';
  var whereObj;
  if (statusFilter === 'ALL') {
    whereObj = { STATUS: 'In(["PENDING","APPROVED","REJECTED","CANCELLED"])' };
  } else {
    whereObj = { STATUS: statusFilter };
  }

  modelView.setProperty('/pendingAction', 'list');
  modelList.setProperty('/busy', true);

  var options = {
    parameters: {
      where: JSON.stringify(whereObj),
      order: JSON.stringify({ CREATED_AT_APP: 'ASC' })
    },
    data: {}
  };
  apigetpeoplehubleaverequest(options);
}

function onStatusFilterChange(oEvent) {
  var selectedItem = oEvent.getParameter('selectedItem');
  var key = selectedItem ? selectedItem.getKey() : 'PENDING';
  modelList.setProperty('/statusFilter', key);
  loadRequests();
}

function onRequestPress(oEvent) {
  var oItem = oEvent.getParameter('listItem') || oEvent.getSource();
  if (!oItem) { return; }
  var ctx = oItem.getBindingContext('List');
  if (!ctx) { return; }
  var row = ctx.getObject();

  modelDetail.setData({
    id: row.id || '',
    PERNR: row.PERNR || '',
    EMPLOYEE_NAME: row.EMPLOYEE_NAME || '',
    MANAGER_PERNR: row.MANAGER_PERNR || '',
    AWART: row.AWART || '',
    TYPE_TEXT: row.TYPE_TEXT || '',
    START_DATE: row.START_DATE || '',
    END_DATE: row.END_DATE || '',
    PERIOD_TEXT: row.PERIOD_TEXT || decoratePeriod(row.START_DATE, row.END_DATE),
    WORKING_DAYS: row.WORKING_DAYS || 0,
    COMMENT: row.COMMENT || '',
    STATUS: row.STATUS || '',
    STATUS_TEXT: row.STATUS_TEXT || getStatusText(row.STATUS),
    STATUS_SCHEME: row.STATUS_SCHEME || getStatusScheme(row.STATUS),
    DECISION_COMMENT: row.DECISION_COMMENT || '',
    DECIDED_BY: row.DECIDED_BY || '',
    DECIDED_AT: row.DECIDED_AT || null,
    CREATED_AT_APP: row.CREATED_AT_APP || null,
    SOURCE: row.SOURCE || '',
    createdBy: row.createdBy || '',
    employee: {
      ORG_TEXT: '',
      POS_TEXT: '',
      MANAGER_TEXT: '',
      hasData: false,
      noData: false
    },
    balance: {
      ITEMS: []
    },
    booked: {
      ITEMS: [],
      SUM_TEXT: 'Total working days booked: 0'
    },
    absences: {
      ITEMS: []
    }
  });

  updateDecisionState();

  loadEmployee(row.PERNR);
  loadLeaveBalance(row.PERNR);
  loadBooked(row.createdBy);
  loadAbsences(row.PERNR, row.START_DATE);

  App.to(pageDetail);
}

function onNavBack(oEvent) {
  App.back();
}

// ===== Leave request table API (shared by list + booked) =====

function onLeaveRequestApiSuccess(xhr) {
  var response = xhr.responseJSON;
  var data = response || [];
  var action = modelView.getProperty('/pendingAction');

  if (action === 'booked') {
    var username = modelView.getProperty('/username');
    var booked = data.map(function (row) {
      return decorateRequestRow(row, username);
    });
    var sum = booked.reduce(function (total, row) {
      return total + (row.WORKING_DAYS || 0);
    }, 0);
    modelDetail.setProperty('/booked/ITEMS', booked);
    modelDetail.setProperty('/booked/SUM_TEXT', 'Total working days booked: ' + sum);
  } else {
    var username2 = modelView.getProperty('/username');
    var list = data.map(function (row) {
      return decorateRequestRow(row, username2);
    });
    modelList.setProperty('/ITEMS', list);
    modelList.setProperty('/count', list.length);
    modelList.setProperty('/busy', false);
  }
}

function onLeaveRequestApiError(xhr) {
  var action = modelView.getProperty('/pendingAction');
  if (action === 'booked') {
    modelDetail.setProperty('/booked/ITEMS', []);
    modelDetail.setProperty('/booked/SUM_TEXT', 'Total working days booked: 0');
  } else {
    modelList.setProperty('/ITEMS', []);
    modelList.setProperty('/count', 0);
    modelList.setProperty('/busy', false);
  }
}

function loadBooked(createdBy) {
  modelView.setProperty('/pendingAction', 'booked');
  var whereObj = {
    createdBy: createdBy,
    STATUS: 'In(["PENDING","APPROVED"])'
  };
  var options = {
    parameters: {
      where: JSON.stringify(whereObj),
      order: JSON.stringify({ CREATED_AT_APP: 'ASC' })
    },
    data: {}
  };
  apigetpeoplehubleaverequest(options);
}

// ===== Employee (SAP) =====

function loadEmployee(pernr) {
  var options = {
    parameters: {
      'sap-client': '100',
      'IV_PERNR': pernr
    }
  };
  apigetEmployees(options);
}

function onEmployeesSuccess(xhr) {
  var response = xhr.responseJSON;
  var list = (response && response.result && response.result.GT_EMPLOYEES) || [];
  if (list.length > 0) {
    var emp = list[0];
    modelDetail.setProperty('/employee', {
      ORG_TEXT: emp.ORG_TEXT || '',
      POS_TEXT: emp.POS_TEXT || '',
      MANAGER_TEXT: emp.MANAGER ? String(emp.MANAGER) : '',
      hasData: true,
      noData: false
    });
  } else {
    modelDetail.setProperty('/employee', {
      ORG_TEXT: '',
      POS_TEXT: '',
      MANAGER_TEXT: '',
      hasData: false,
      noData: true
    });
  }
}

function onEmployeesError(xhr) {
  modelDetail.setProperty('/employee', {
    ORG_TEXT: '',
    POS_TEXT: '',
    MANAGER_TEXT: '',
    hasData: false,
    noData: true
  });
}

// ===== Leave balance (SAP) =====

function loadLeaveBalance(pernr) {
  var options = {
    parameters: {
      'sap-client': '100',
      'IV_PERNR': pernr
    }
  };
  apigetLeaveBalance(options);
}

function onLeaveBalanceSuccess(xhr) {
  var response = xhr.responseJSON;
  var list = (response && response.result && response.result.GT_BALANCES) || [];
  var mapped = list.map(function (row) {
    row.VALIDITY_TEXT = formatSapDate(row.VALID_FROM) + ' - ' + formatSapDate(row.VALID_TO);
    return row;
  });
  modelDetail.setProperty('/balance/ITEMS', mapped);
}

function onLeaveBalanceError(xhr) {
  modelDetail.setProperty('/balance/ITEMS', []);
}

// ===== Absences (SAP) =====

function loadAbsences(pernr, startIso) {
  var year = (startIso && startIso.length >= 4) ? startIso.substring(0, 4) : String(new Date().getFullYear());
  var options = {
    parameters: {
      'sap-client': '100',
      'IV_PERNR': pernr,
      'IV_FROM': year + '0101',
      'IV_TO': year + '1231'
    }
  };
  apigetAbsences(options);
}

function onAbsencesSuccess(xhr) {
  var response = xhr.responseJSON;
  var list = (response && response.result && response.result.GT_ABSENCES) || [];
  var reqStart = isoToNum(modelDetail.getProperty('/START_DATE'));
  var reqEnd = isoToNum(modelDetail.getProperty('/END_DATE'));
  var mapped = list.map(function (row) {
    row.PERIOD_TEXT = formatSapDate(row.BEGDA) + ' - ' + formatSapDate(row.ENDDA);
    var begNum = sapDateToNum(row.BEGDA);
    var endNum = sapDateToNum(row.ENDDA);
    row.OVERLAPS = (begNum <= reqEnd && endNum >= reqStart);
    return row;
  });
  modelDetail.setProperty('/absences/ITEMS', mapped);
}

function onAbsencesError(xhr) {
  modelDetail.setProperty('/absences/ITEMS', []);
}

// ---------- Approve / Reject (PeopleHubLeaveRequestDecideApi) ----------
// The server checks the manager role and the PENDING status again. On approve it creates the
// confirmation PDF and emails it to the employee; on reject it emails the reason.
var CONFIRMATION_URL = '/api/serverscript/PeopleHubLeaveConfirmationFileApi/?id=';

function updateDecisionState() {
    var status = modelDetail.getProperty('/STATUS');
    modelDetail.setProperty('/canDecide', status === 'PENDING');
    modelDetail.setProperty('/hasPdf', status === 'APPROVED');
}

function openDecision(decision) {
    var r = modelDetail.getData() || {};
    if (r.STATUS !== 'PENDING' || !r.id) return;
    var approve = decision === 'APPROVED';
    modelDetail.setProperty('/decision', {
        decision: decision,
        title: approve ? 'Approve leave request' : 'Reject leave request',
        summary: (r.EMPLOYEE_NAME || '') + ': ' + (r.TYPE_TEXT || '') + ', ' + (r.PERIOD_TEXT || '') + ', ' + (r.WORKING_DAYS || 0) + ' working day(s).' +
            (r.ISOWN || r.createdBy === modelView.getProperty('/username') ? ' This is your own request.' : ''),
        commentLabel: approve ? 'Comment for the employee (optional)' : 'Reason (required)',
        required: !approve,
        comment: '',
        buttonText: approve ? 'Approve' : 'Reject',
        buttonType: approve ? 'Accept' : 'Reject',
        busy: false,
        message: '',
        showMessage: false
    });
    btnConfirmDecision.setEnabled(true);
    dlgDecision.open();
}

function setDecisionMessage(text) {
    modelDetail.setProperty('/decision/message', text || '');
    modelDetail.setProperty('/decision/showMessage', !!text);
}

function onApprove() {
    openDecision('APPROVED');
}

function onReject() {
    openDecision('REJECTED');
}

function onDecisionCommentChange() {
    setDecisionMessage('');
}

function onConfirmDecision() {
    var d = modelDetail.getProperty('/decision') || {};
    var comment = (txtDecisionComment.getValue() || '').trim();
    if (d.decision === 'REJECTED' && !comment) {
        setDecisionMessage('Give a reason for the rejection.');
        return;
    }
    modelDetail.setProperty('/decision/busy', true);
    btnConfirmDecision.setEnabled(false);
    apipostDecideLeaveRequest({ data: { id: modelDetail.getProperty('/id'), decision: d.decision, comment: comment } });
}

function onDecideSuccess(xhr) {
    var r = xhr.responseJSON || {};
    modelDetail.setProperty('/STATUS', r.STATUS);
    modelDetail.setProperty('/STATUS_TEXT', getStatusText(r.STATUS));
    modelDetail.setProperty('/STATUS_SCHEME', getStatusScheme(r.STATUS));
    modelDetail.setProperty('/DECISION_COMMENT', (txtDecisionComment.getValue() || '').trim());
    modelDetail.setProperty('/DECIDED_BY', modelView.getProperty('/username'));
    modelDetail.setProperty('/decision/busy', false);
    btnConfirmDecision.setEnabled(true);
    updateDecisionState();
    dlgDecision.close();

    var problems = [];
    if (r.STATUS === 'APPROVED' && !r.pdfCreated) problems.push(r.pdfMessage);
    if (!r.emailSent) problems.push(r.emailMessage);
    if (problems.length) {
        sap.m.MessageBox.warning('The request is ' + getStatusText(r.STATUS).toLowerCase() + ', but: ' + problems.join(' '));
    } else {
        sap.m.MessageToast.show(getStatusText(r.STATUS) + '. ' + (r.pdfCreated ? 'Confirmation PDF created. ' : '') + r.emailMessage);
    }
    loadRequests();
}

function onDecideError(xhr) {
    var r = (xhr && xhr.responseJSON) || {};
    modelDetail.setProperty('/decision/busy', false);
    btnConfirmDecision.setEnabled(true);
    setDecisionMessage(r.error || 'The decision could not be saved.');
}

// The PDF is served by the server as a real file, so the browser shows it in a new tab
function onOpenConfirmationPdf() {
    var id = modelDetail.getProperty('/id');
    if (!id) return;
    window.open(CONFIRMATION_URL + encodeURIComponent(id), '_blank');
}

initData();
