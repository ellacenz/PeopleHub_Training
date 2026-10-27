async function getAllUserTasks() {
    const { status, data, error } = await neptune.Utils.request("/api/functions/ProcessFlows/GetAllAssignedTasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            dateFrom: toolLogFileFilterDateFrom.getDateValue(),
            dateTo: toolLogFileFilterDateTo.getDateValue(),
            status: toolStartStatus.getSelectedKeys(),
        }),
    });

    if (status !== "ok") {
        return { error: error || new Error(status) };
    }

    return data;
}

async function continueTask(task, action) {
    let startParamsObj = {};

    try {
        const startParamsStr = task?.embeddedInfo?.appInfo?.startParams;
        startParamsObj = startParamsStr ? JSON.parse(startParamsStr) : {};
    } catch {
        startParamsObj = {};
    }

    const startParamsCopy = structuredClone(startParamsObj);

    const { status, error } = await neptune.Utils.request("/api/functions/ProcessFlows/ContinueUserTask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            processFlowId: task.processFlowId,
            executionId: task.executionId,
            activityExecutionId: task.activityExecutionId,
            userTaskId: task.id,
            payload: {
                approverDecision: action.value,
                ...startParamsCopy,
            },
        }),
    });

    if (status !== "ok") {
        sap.m.MessageToast.show(`Error: ${error?.status || status}`);
        return;
    }

    sap.m.MessageToast.show("Task completed");
    diaUserTask.close();
    await loadUserTasks();
}

async function loadUserTasks() {
    modelUserTasks.setProperty("/selectedItem", null);
    const userTasks = await getAllUserTasks();

    if (userTasks.error) {
        sap.m.MessageToast.show(`Error fetching user tasks: ${userTasks.error.toString()}`);
        return;
    }

    oPageHeaderNumber.setNumber("(" + userTasks?.length + ")");

    modelUserTasks.setData({
        pending: userTasks.filter(({ status }) => status === "pending"),
        completed: userTasks.filter(({ status }) => status === "complete"),
    });

    toolStartUpdate.focus();
}

function isInvalidDateRange(dateFrom, dateTo) {
    return dateFrom && dateTo && dateFrom.getTime() > dateTo.getTime();
}
