// ===== Onboarding Tasks - GlobalFunctions =====

function formatDisplayDate(d) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return 'No due date';
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

function decorateTask(t) {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var due = t.dueDate ? new Date(t.dueDate) : null;
    var hasValidDue = due && !isNaN(due.getTime());
    var dueDay = hasValidDue ? new Date(due.getFullYear(), due.getMonth(), due.getDate()) : null;

    if (t.done) {
        t.statusState = 'Success';
        t.statusText = 'Done';
    } else if (hasValidDue && dueDay.getTime() < today.getTime()) {
        t.statusState = 'Error';
        t.statusText = 'Overdue';
    } else if (hasValidDue && dueDay.getTime() === today.getTime()) {
        t.statusState = 'Warning';
        t.statusText = 'Due Today';
    } else {
        t.statusState = 'Information';
        t.statusText = 'Upcoming';
    }
    t.dueDateDisplay = hasValidDue ? formatDisplayDate(due) : 'No due date';
    t.dueDateSort = hasValidDue ? due.getTime() : Number.MAX_SAFE_INTEGER;
    return t;
}

function updateViewState(state) {
    var items = modelTasks.getProperty('/ITEMS') || [];
    var filtered = modelTasks.getProperty('/FILTERED') || [];
    modelTasks.setProperty('/loadStateRaw', state);
    modelTasks.setProperty('/view', {
        showLoading: state === 'loading',
        showError: state === 'error',
        showEmpty: state === 'ready' && items.length === 0,
        showNoResults: state === 'ready' && items.length > 0 && filtered.length === 0,
        showList: state === 'ready' && filtered.length > 0
    });
}

function applyFilterAndSort() {
    var items = modelTasks.getProperty('/ITEMS') || [];
    var search = (modelTasks.getProperty('/searchText') || '').trim().toLowerCase();
    var filtered = search
        ? items.filter(function (t) { return (t.title || '').toLowerCase().indexOf(search) > -1; })
        : items.slice();

    filtered.sort(function (a, b) { return a.dueDateSort - b.dueDateSort; });

    modelTasks.setProperty('/FILTERED', filtered);
    modelTasks.setProperty('/count', filtered.length);
}

function cacheInitLoadFinished() {
    if (modelTasks.getProperty('/ITEMS') === undefined || modelTasks.getProperty('/ITEMS') === null) {
        modelTasks.setProperty('/ITEMS', []);
    }
    if (modelTasks.getProperty('/FILTERED') === undefined) {
        modelTasks.setProperty('/FILTERED', []);
    }
    if (modelTasks.getProperty('/searchText') === undefined) {
        modelTasks.setProperty('/searchText', '');
    }
    if (modelTasks.getProperty('/isOffline') === undefined) {
        modelTasks.setProperty('/isOffline', false);
    }
    if (modelTasks.getProperty('/count') === undefined) {
        modelTasks.setProperty('/count', 0);
    }

    var cachedItems = modelTasks.getProperty('/ITEMS') || [];

    if (navigator.onLine) {
        updateViewState('loading');
        apigetOnboardingtask({ parameters: {} });
    } else if (cachedItems.length > 0) {
        modelTasks.setProperty('/isOffline', true);
        applyFilterAndSort();
        updateViewState('ready');
        sap.m.MessageToast.show('You are offline. Showing the last loaded tasks.');
    } else {
        modelTasks.setProperty('/isOffline', true);
        updateViewState('ready');
    }
}

function onRefresh() {
    if (!navigator.onLine) {
        sap.m.MessageToast.show('You are offline. Showing cached tasks.');
        return;
    }
    updateViewState('loading');
    apigetOnboardingtask({ parameters: {} });
}

function onSearchChanged(value) {
    modelTasks.setProperty('/searchText', value || '');
    applyFilterAndSort();
    var state = modelTasks.getProperty('/loadStateRaw');
    if (state === 'ready') {
        updateViewState('ready');
    }
}

// Set an initial loading look before the cache bootstrap / API responds
modelTasks.setProperty('/view', {
    showLoading: true,
    showError: false,
    showEmpty: false,
    showNoResults: false,
    showList: false
});

window.addEventListener('offline', function () {
    modelTasks.setProperty('/isOffline', true);
    sap.m.MessageToast.show('You are offline. Showing cached tasks.');
});

window.addEventListener('online', function () {
    modelTasks.setProperty('/isOffline', false);
    sap.m.MessageToast.show('Back online. Refreshing tasks...');
    onRefresh();
});
