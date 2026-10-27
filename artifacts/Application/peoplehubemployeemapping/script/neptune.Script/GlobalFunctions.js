// ===== PeopleHub Employee Mapping (trainer) =====
// Read: PeopleHubTrainerParticipantsApi (GET, optional ?search=). Write: PeopleHubTrainerMappingSaveApi (POST save / remove / automap).

function initApp() {
	modelList.setData({
		trainer: '',
		sapAvailable: false,
		participants: [],
		filteredParticipants: [],
		employees: [],
		validEmployees: [],
		suggestedPernr: '',
		suggestedText: '',
		filter: { status: 'All' },
		summary: { participants: 0, mapped: 0, notMapped: 0, missingRole: 0 },
		badgeParticipantsText: 'Participants: 0',
		badgeMappedText: 'Mapped: 0',
		badgeNotMappedText: 'Not mapped: 0',
		badgeMissingRoleText: 'Missing role: 0',
		tableTitle: 'Participants (0)',
		busy: false,
		errorVisible: false,
		errorText: '',
		reopenUser: '',
		saveAction: '',
		autoMap: { plan: [], message: '', canConfirm: false, busy: false },
		addUser: { query: '', users: [], message: 'Type a user name, name or email and press Enter.', busy: false }
	});

	modelDetail.setData({
		participant: {
			USER_NAME: '', NAME: '', EMAIL: '', ROLES_TEXT: '',
			PERNR: '', MAPPED: false, SAP_NAME: '', SAP_ORG: '',
			SAP_MANAGER: '', SAP_MANAGER_NAME: '',
			STATUS_TEXT: '', STATUS_STATE: 'None'
		},
		employees: [],
		selectedPernr: null,
		hasMapping: false,
		notMappedVisible: true,
		suggestionText: '',
		suggestionVisible: false,
		busy: false
	});

	loadParticipants();
}

// ---------- Read ----------

function loadParticipants(search) {
	modelList.setProperty('/busy', true);
	modelList.setProperty('/errorVisible', false);
	modelList.setProperty('/errorText', '');
	apigetPeopleHubTrainerParticipantsApi({ parameters: { search: search || '' } });
}

function onRefreshParticipants() {
	loadParticipants();
}

function onGetParticipantsSuccess(xhr) {
	var response = xhr.responseJSON;
	modelList.setProperty('/busy', false);
	modelList.setProperty('/addUser/busy', false);

	if (!response || response.ok === false) {
		modelList.setProperty('/errorVisible', true);
		modelList.setProperty('/errorText', (response && response.error) || 'Could not load participants.');
		modelList.setProperty('/participants', []);
		modelList.setProperty('/filteredParticipants', []);
		recomputeSummary();
		return;
	}

	var participants = response.participants || [];
	modelList.setProperty('/trainer', response.trainer || '');
	modelList.setProperty('/sapAvailable', !!response.sapAvailable);
	modelList.setProperty('/participants', participants);
	modelList.setProperty('/employees', response.employees || []);
	modelList.setProperty('/validEmployees', response.validEmployees || []);
	modelList.setProperty('/suggestedPernr', response.suggestedPernr || '');
	modelList.setProperty('/suggestedText', response.suggestedText || '');
	if (!response.sapAvailable) {
		modelList.setProperty('/errorVisible', true);
		modelList.setProperty('/errorText', 'SAP is not available: names and the employee list are missing. Try Refresh later.');
	}

	recomputeSummary();
	applyParticipantFilter();

	// Result of the Add user search
	if (response.users) {
		var users = response.users.map(function (u) {
			u.INFO = u.IS_PARTICIPANT ? 'Participant' : '';
			return u;
		});
		modelList.setProperty('/addUser/users', users);
		modelList.setProperty('/addUser/message', users.length ? 'Select a user to map.' : 'No user found.');
	}

	// After a save or remove: show the participant again with the new data
	var reopen = modelList.getProperty('/reopenUser');
	if (reopen) {
		modelList.setProperty('/reopenUser', '');
		var p = participants.filter(function (x) { return x.USER_NAME === reopen; })[0];
		openParticipantDetail(p || stubParticipant({ USER_NAME: reopen }));
	}
}

function onGetParticipantsError(xhr) {
	modelList.setProperty('/busy', false);
	modelList.setProperty('/addUser/busy', false);
	modelList.setProperty('/errorVisible', true);
	modelList.setProperty('/errorText', 'Request failed. Please try again.');
}

// Summary counts are ALWAYS derived from the participants rows themselves (single source of truth)
function recomputeSummary() {
	var all = modelList.getProperty('/participants') || [];
	var total = all.length;
	var notMapped = all.filter(function (p) { return p.STATUS_TEXT === 'Not mapped'; }).length;
	var missingRole = all.filter(function (p) { return (p.STATUS_TEXT || '').indexOf('Missing role') === 0; }).length;
	var ready = all.filter(function (p) { return p.STATUS_TEXT === 'Ready'; }).length;
	var mapped = all.filter(function (p) { return !!p.MAPPED; }).length;

	modelList.setProperty('/summary', { participants: total, mapped: mapped, notMapped: notMapped, missingRole: missingRole, ready: ready });
	modelList.setProperty('/badgeParticipantsText', 'Participants: ' + total);
	modelList.setProperty('/badgeMappedText', 'Mapped: ' + mapped);
	modelList.setProperty('/badgeNotMappedText', 'Not mapped: ' + notMapped);
	modelList.setProperty('/badgeMissingRoleText', 'Missing role: ' + missingRole);
}

function applyParticipantFilter() {
	var all = modelList.getProperty('/participants') || [];
	var status = modelList.getProperty('/filter/status') || 'All';
	// 'Missing role' also matches 'Missing role: Manager' and 'Missing role: Employee'
	var filtered = status === 'All' ? all : all.filter(function (p) { return (p.STATUS_TEXT || '').indexOf(status) === 0; });
	modelList.setProperty('/filteredParticipants', filtered);
	modelList.setProperty('/tableTitle', 'Participants (' + filtered.length + ')');
	modelList.checkUpdate(true);
}

function onFilterChange(oEvent) {
	applyParticipantFilter();
}

// ---------- Detail ----------

function onParticipantPress(oEvent) {
	var oItem = oEvent.getParameter('listItem') || oEvent.getSource();
	if (!oItem) { return; }
	var ctx = oItem.getBindingContext('List');
	if (!ctx) { return; }
	openParticipantDetail(ctx.getObject());
}

function stubParticipant(u) {
	return {
		USER_NAME: u.USER_NAME, NAME: u.NAME || '', EMAIL: u.EMAIL || '', ROLES_TEXT: 'None',
		PERNR: '', MAPPED: false, SAP_NAME: '', SAP_ORG: '', SAP_MANAGER: '', SAP_MANAGER_NAME: '',
		STATUS_TEXT: 'Not mapped', STATUS_STATE: 'Error'
	};
}

// Only valid employees (Bill West and his reports) can be picked. A participant without a valid
// mapping gets the suggested one preselected: the least used recommended employee.
function openParticipantDetail(participant) {
	var employees = modelList.getProperty('/validEmployees') || [];
	var hasMapping = !!participant.MAPPED;
	var validPernr = employees.some(function (e) { return e.PERNR === participant.PERNR; });
	var suggested = modelList.getProperty('/suggestedPernr') || (employees.length ? employees[0].PERNR : null);
	var useSuggestion = !validPernr && !!suggested;

	modelDetail.setData({
		participant: participant,
		employees: employees,
		selectedPernr: validPernr ? participant.PERNR : suggested,
		hasMapping: hasMapping,
		notMappedVisible: !hasMapping,
		suggestionText: 'Suggested: ' + modelList.getProperty('/suggestedText') + ' (the least used employee). Select Save mapping to use it, or pick another one.',
		suggestionVisible: useSuggestion,
		busy: false
	});

	App.to(pageDetail);
}

function onBackToList() {
	App.to(pageSearch);
}

// ---------- Save / remove one mapping (PeopleHubTrainerMappingSaveApi) ----------

function postMapping(body) {
	modelList.setProperty('/saveAction', body.action + (body.action === 'automap' ? (body.preview ? 'Preview' : 'Run') : ''));
	apipostTrainerMappingSave({ data: body });
}

function onSaveMapping() {
	var p = modelDetail.getProperty('/participant');
	var pernr = modelDetail.getProperty('/selectedPernr');
	if (!pernr) {
		sap.m.MessageToast.show('Select a SAP employee first.');
		return;
	}
	modelDetail.setProperty('/busy', true);
	postMapping({ action: 'save', username: p.USER_NAME, pernr: pernr });
}

function onRemoveMapping() {
	var p = modelDetail.getProperty('/participant');
	sap.m.MessageBox.confirm('Remove the SAP mapping of ' + (p.NAME || p.USER_NAME) + '? The leave apps will not find their SAP employee any more.', {
		onClose: function (action) {
			if (action !== sap.m.MessageBox.Action.OK) return;
			modelDetail.setProperty('/busy', true);
			postMapping({ action: 'remove', username: p.USER_NAME });
		}
	});
}

function onMappingSaveSuccess(xhr) {
	var r = xhr.responseJSON || {};
	var action = modelList.getProperty('/saveAction');
	modelDetail.setProperty('/busy', false);

	if (action === 'automapPreview') {
		modelList.setProperty('/autoMap/busy', false);
		modelList.setProperty('/autoMap/plan', r.plan || []);
		modelList.setProperty('/autoMap/message', r.message || '');
		modelList.setProperty('/autoMap/canConfirm', (r.count || 0) > 0);
		return;
	}
	if (action === 'automapRun') {
		modelList.setProperty('/autoMap/busy', false);
		dlgAutoMap.close();
		sap.m.MessageToast.show(r.message || 'Participants mapped.');
		loadParticipants();
		return;
	}

	sap.m.MessageToast.show(r.message || 'Saved.');
	modelList.setProperty('/reopenUser', r.username || modelDetail.getProperty('/participant/USER_NAME'));
	loadParticipants();
}

function onMappingSaveError(xhr) {
	var r = (xhr && xhr.responseJSON) || {};
	modelDetail.setProperty('/busy', false);
	modelList.setProperty('/autoMap/busy', false);
	sap.m.MessageBox.error(r.error || 'The mapping could not be saved.');
}

// ---------- Auto-map ----------

function onOpenAutoMap() {
	modelList.setProperty('/autoMap', { plan: [], message: 'Checking the participants without a mapping…', canConfirm: false, busy: true });
	dlgAutoMap.open();
	postMapping({ action: 'automap', preview: true });
}

function onConfirmAutoMap() {
	modelList.setProperty('/autoMap/busy', true);
	modelList.setProperty('/autoMap/canConfirm', false);
	postMapping({ action: 'automap', preview: false });
}

// ---------- Add user (map someone who has no leave role yet) ----------

function onOpenAddUser() {
	modelList.setProperty('/addUser', { query: '', users: [], message: 'Type a user name, name or email and press Enter.', busy: false });
	dlgAddUser.open();
}

function onUserSearch(oEvent) {
	var q = (oEvent.getParameter('query') || '').trim();
	if (q.length < 2) {
		modelList.setProperty('/addUser/message', 'Type at least 2 characters.');
		return;
	}
	modelList.setProperty('/addUser/busy', true);
	loadParticipants(q);
}

function onAddUserPick(oEvent) {
	var oItem = oEvent.getParameter('listItem') || oEvent.getSource();
	var ctx = oItem && oItem.getBindingContext('List');
	if (!ctx) return;
	var u = ctx.getObject();
	dlgAddUser.close();
	var existing = (modelList.getProperty('/participants') || []).filter(function (x) { return x.USER_NAME === u.USER_NAME; })[0];
	openParticipantDetail(existing || stubParticipant(u));
}

initApp();
