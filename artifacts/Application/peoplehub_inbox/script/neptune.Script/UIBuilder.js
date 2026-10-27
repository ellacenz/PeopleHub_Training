function buildTaskActionButtons(task) {
    diaUserTaskActions.removeAllItems();
    let actions = task.taskActions;
    actions.forEach((action) => {
        const btn = new sap.m.Button({
            text: action.title,
            type: action.type === "command" ? "Emphasized" : "Default",
            press: () => onTaskActionPress(task, action),
            enabled: task.status !== "complete",
        }).addStyleClass("sapUiTinyMarginEnd");

        diaUserTaskActions.addItem(btn);
    });
}

async function onTaskActionPress(task, action) {
        await continueTask(task, action);

    if (action.type === "application") {
        applicationBox.removeAllContent();
        applicationBox.setBusy(true);

        try {
            const result = await AppCache.Load(action.appInfo.appName, {
                parentObject: applicationBox,
                startParams: action.appInfo.startParams,
            });

            if (result?.error) {
                throw new Error(result.error);
            }
            diaUserTask.open();
        } catch (err) {
            console.error("Embedded app load failed", err);
        } finally {
            applicationBox.setBusy(false);
        }
    }
}
