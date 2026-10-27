function initData() {
  modelView.setData({
    user: null,
    isEmployee: false,
    mapped: true,
    unmappedMessage: '',
    showUnmappedMessage: false
  });
  modelRequests.setData({ ITEMS: [] });
  modelDetail.setData({});
  modelBalance.setData({ ITEMS: [] });
  modelAbsences.setData({ ITEMS: [] });

  apigetPeopleHubLeaveRequestUserApi();
}

function onUserApiSuccess(xhr) {
  var response = xhr ? xhr.responseJSON : null;
  if (!response) return;

  modelView.setData({
    user: response,
    isEmployee: !!response.isEmployee,
    mapped: !!response.mapped,
    unmappedMessage: response.message || 'User is not mapped to an SAP employee.',
    showUnmappedMessage: !response.mapped
  });

  if (response.isEmployee && response.username) {
    loadLeaveRequests(response.username);
  }
}

function loadLeaveRequests(username) {
  if (!username) {
    var viewData = modelView.getData();
    if (viewData && viewData.user && viewData.user.username) {
      username = viewData.user.username;
    }
  }
  if (!username) return;

  var options = {
    parameters: {
      'where': JSON.stringify({ 'createdBy': username }),
      'order': JSON.stringify({ 'CREATED_AT_APP': 'DESC' })
    }
  };
  apigetpeoplehubleaverequest(options);
}

function onGetRequestsSuccess(xhr) {
    var response = xhr ? xhr.responseJSON : null;
    var items = Array.isArray(response) ? response : [];
    items.forEach(decorateStatus);
    modelRequests.setData({ ITEMS: items });
}

function onRequestItemPress(oEvent) {
  var oItem = oEvent.getParameter('listItem') || oEvent.getSource();
  if (!oItem) return;
  var ctx = oItem.getBindingContext('Requests');
  if (!ctx) return;
  var data = ctx.getObject();

  modelDetail.setData(data || {});
  modelDetail.setProperty('/canSend', data.STATUS === 'DRAFT');
  modelDetail.setProperty('/canDelete', data.STATUS === 'DRAFT');
  modelDetail.setProperty('/hasPdf', data.STATUS === 'APPROVED');
  modelBalance.setData({ ITEMS: [] });
  modelAbsences.setData({ ITEMS: [] });

  var pernr = data.PERNR;
  var startYear = new Date().getFullYear();
  if (data.START_DATE && data.START_DATE.length >= 4) {
    var yr = parseInt(data.START_DATE.substring(0, 4), 10);
    if (!isNaN(yr) && yr > 1900) startYear = yr;
  }

  if (pernr) {
    apigetLeaveBalance({
      parameters: {
        'sap-client': '100',
        'IV_PERNR': String(pernr)
      }
    });

    apigetAbsences({
      parameters: {
        'sap-client': '100',
        'IV_PERNR': String(pernr),
        'IV_FROM': startYear + '0101',
        'IV_TO': startYear + '1231'
      }
    });
  }

  App.to(pageDetail);
}

function onGetLeaveBalanceSuccess(xhr) {
  var response = xhr ? xhr.responseJSON : null;
  var data = (response && response.result && Array.isArray(response.result.GT_BALANCES)) ? response.result.GT_BALANCES : [];
  modelBalance.setData({ ITEMS: data });
}

function onGetLeaveBalanceError(xhr) {
  modelBalance.setData({ ITEMS: [] });
}

function onGetAbsencesSuccess(xhr) {
  var response = xhr ? xhr.responseJSON : null;
  var data = (response && response.result && Array.isArray(response.result.GT_ABSENCES)) ? response.result.GT_ABSENCES : [];
  modelAbsences.setData({ ITEMS: data });
}

function onGetAbsencesError(xhr) {
  modelAbsences.setData({ ITEMS: [] });
}

function onNavBack() {
  App.to(pageList);
}

function onRefreshList() {
  loadLeaveRequests();
}

// ---------- New leave request ----------
// The server (PeopleHubLeaveRequestCreateApi) counts the working days and runs every check.
// While the user fills in the dialog we send preview = true; Submit sends preview = false and saves.
var LEAVE_TYPES = [
    { key: '0100', text: 'Leave' },
    { key: '0190', text: 'Educational Leave' },
    { key: '0300', text: 'Paid Leave of Absence' },
    { key: '0620', text: 'Unpaid Leave' }
];

function onNewRequest() {
    modelNewRequest.setData({
        types: LEAVE_TYPES,
        AWART: '0100',
        START_DATE: '',
        END_DATE: '',
        COMMENT: '',
        canSubmit: false,
        submitting: false,
        checkVisible: true,
        checkText: 'Choose the period of your leave.',
        checkType: 'Information'
    });
    dpNewStart.setMinDate(new Date());
    dpNewEnd.setMinDate(new Date());
    dlgNewRequest.open();
}

function showNewCheck(text, type) {
    modelNewRequest.setProperty('/checkText', text);
    modelNewRequest.setProperty('/checkType', type);
    modelNewRequest.setProperty('/checkVisible', true);
}

function newRequestBody(preview) {
    var d = modelNewRequest.getData();
    return {
        AWART: d.AWART,
        START_DATE: d.START_DATE,
        END_DATE: d.END_DATE || d.START_DATE,
        COMMENT: d.COMMENT,
        preview: preview
    };
}

// The answer belongs to what is in the dialog now (an older check can arrive late)
function matchesNewRequest(r) {
    var d = modelNewRequest.getData();
    return r.AWART === d.AWART && r.START_DATE === d.START_DATE && r.END_DATE === (d.END_DATE || d.START_DATE);
}

// Every change is checked again on the server; Submit stays off until the check passes
function onNewRequestChanged() {
    var d = modelNewRequest.getData();
    modelNewRequest.setProperty('/canSubmit', false);
    modelNewRequest.setProperty('/submitting', false);
    if (!d.START_DATE) {
        showNewCheck('Choose the period of your leave.', 'Information');
        return;
    }
    if (!d.END_DATE) modelNewRequest.setProperty('/END_DATE', d.START_DATE);
    showNewCheck('Checking with SAP...', 'Information');
    apipostCreateLeaveRequest({ data: newRequestBody(true) });
}

function onSubmitRequest() {
    if (!modelNewRequest.getProperty('/canSubmit')) return;
    modelNewRequest.setProperty('/canSubmit', false);
    modelNewRequest.setProperty('/submitting', true);
    showNewCheck('Sending your request...', 'Information');
    apipostCreateLeaveRequest({ data: newRequestBody(false) });
}

function onCreateSuccess(xhr) {
    var r = xhr.responseJSON || {};
    if (!r.preview) {
        dlgNewRequest.close();
        sap.m.MessageToast.show('Leave request saved as draft (' + r.WORKING_DAYS + ' working day(s)). Open it to send it for approval.');
        loadLeaveRequests();
        return;
    }
    if (!matchesNewRequest(r)) return;
    var text = r.WORKING_DAYS + ' working day(s) of ' + r.TYPE_TEXT + '.';
    var holidays = (r.holidays || []).map(function (h) { return h.date + ' ' + h.text; });
    if (holidays.length) text += ' Public holidays not counted: ' + holidays.join(', ') + '.';
    if (r.quotaMessage) text += ' SAP: ' + r.quotaMessage;
    showNewCheck(text, 'Success');
    modelNewRequest.setProperty('/canSubmit', true);
}

function onCreateError(xhr) {
    var r = (xhr && xhr.responseJSON) || {};
    var submitting = modelNewRequest.getProperty('/submitting');
    if (!submitting && r.START_DATE && !matchesNewRequest(r)) return;
    modelNewRequest.setProperty('/submitting', false);
    modelNewRequest.setProperty('/canSubmit', false);
    showNewCheck(r.error || 'The request could not be checked.', 'Error');
}

// ---------- Send for approval ----------
// Only an own DRAFT can be sent (the server checks it again): it becomes PENDING
// and every user with the role PeopleHubManagerTrainingME gets an email.
function onSendForApproval() {
    var r = modelDetail.getData() || {};
    if (r.STATUS !== 'DRAFT' || !r.id) return;
    sap.m.MessageBox.confirm(
        'Send your leave request from ' + r.START_DATE + ' to ' + r.END_DATE + ' for approval? The managers get an email.',
        {
            title: 'Send for approval',
            onClose: function (action) {
                if (action !== sap.m.MessageBox.Action.OK) return;
                modelDetail.setProperty('/canSend', false);
                apipostSendLeaveRequest({ data: { id: r.id } });
            }
        }
    );
}

function onSendSuccess(xhr) {
    var r = xhr.responseJSON || {};
    var detail = modelDetail.getData() || {};
    detail.STATUS = r.STATUS || 'PENDING';
    decorateStatus(detail);
    modelDetail.setData(detail);
    modelDetail.setProperty('/canSend', false);
    modelDetail.setProperty('/canDelete', false);
    if (r.emailSent) {
        sap.m.MessageToast.show('Sent for approval. ' + r.emailMessage);
    } else {
        sap.m.MessageBox.warning('Your request is pending, but: ' + (r.emailMessage || 'no email was sent.'));
    }
    loadLeaveRequests();
}

function onSendError(xhr) {
    var r = (xhr && xhr.responseJSON) || {};
    modelDetail.setProperty('/canSend', modelDetail.getProperty('/STATUS') === 'DRAFT');
    sap.m.MessageBox.error(r.error || 'The request could not be sent for approval.');
}

// ---------- Delete a draft ----------
// Only an own DRAFT can be deleted (the server checks it again); a sent request stays in the history.
function onDeleteRequest() {
    var r = modelDetail.getData() || {};
    if (r.STATUS !== 'DRAFT' || !r.id) return;
    sap.m.MessageBox.confirm(
        'Delete your draft leave request from ' + r.START_DATE + ' to ' + r.END_DATE + '? This cannot be undone.',
        {
            title: 'Delete draft',
            emphasizedAction: sap.m.MessageBox.Action.CANCEL,
            onClose: function (action) {
                if (action !== sap.m.MessageBox.Action.OK) return;
                modelDetail.setProperty('/canDelete', false);
                modelDetail.setProperty('/canSend', false);
                apipostDeleteLeaveRequest({ data: { id: r.id } });
            }
        }
    );
}

function onDeleteSuccess(xhr) {
    sap.m.MessageToast.show('Draft deleted.');
    modelDetail.setData({});
    loadLeaveRequests();
    onNavBack();
}

function onDeleteError(xhr) {
    var r = (xhr && xhr.responseJSON) || {};
    var isDraft = modelDetail.getProperty('/STATUS') === 'DRAFT';
    modelDetail.setProperty('/canDelete', isDraft);
    modelDetail.setProperty('/canSend', isDraft);
    sap.m.MessageBox.error(r.error || 'The draft could not be deleted.');
}

// ---------- Status text and color (sap.tnt.InfoLabel colorScheme 1-10) ----------
var STATUS_LOOK = {
    DRAFT: { text: 'Draft', color: 5 },
    PENDING: { text: 'Pending approval', color: 1 },
    APPROVED: { text: 'Approved', color: 8 },
    REJECTED: { text: 'Rejected', color: 3 },
    CANCELLED: { text: 'Cancelled', color: 10 }
};

function decorateStatus(row) {
    var look = STATUS_LOOK[row.STATUS] || { text: row.STATUS || '', color: 10 };
    row.statusText = look.text;
    row.statusColor = look.color;
    return row;
}

// ---------- Confirmation PDF of an approved request ----------
// Created by the manager's approval (PDF Archive); the server returns it as a real PDF file.
// Served by the PeopleHubLeaveConfirmationFileApi server-script API (wired as getConfirmationPdf).
var CONFIRMATION_URL = '/api/serverscript/peoplehubleaveconfirmationfileapi/?id=';

function onOpenConfirmationPdf() {
    var id = modelDetail.getProperty('/id');
    if (!id) return;
    window.open(CONFIRMATION_URL + encodeURIComponent(id), '_blank');
}

initData();