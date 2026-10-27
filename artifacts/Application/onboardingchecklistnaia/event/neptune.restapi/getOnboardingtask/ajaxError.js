var items = modelTasks.getProperty('/ITEMS') || [];
if (items.length > 0) {
    modelTasks.setProperty('/isOffline', true);
    applyFilterAndSort();
    updateViewState('ready');
    sap.m.MessageToast.show('Could not reach the server. Showing cached tasks.');
} else {
    updateViewState('error');
    sap.m.MessageToast.show('Failed to load tasks.');
}