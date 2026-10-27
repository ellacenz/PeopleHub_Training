var response = xhr.responseJSON;
var data = response;
if (!Array.isArray(data)) { data = data ? [data] : []; }
data.forEach(function (t) { decorateTask(t); });
modelTasks.setProperty('/ITEMS', data);
modelTasks.setProperty('/isOffline', false);
applyFilterAndSort();
updateViewState('ready');