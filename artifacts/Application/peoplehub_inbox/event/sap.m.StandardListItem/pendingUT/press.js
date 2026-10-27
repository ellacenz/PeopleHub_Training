(async () => {
    const item = oEvent.getSource();
    const userTask = item.getBindingContext("UserTasks").getObject();

    buildTaskActionButtons(userTask);
    modelUserTasks.setProperty("/selectedItem", userTask);

    const embededInfoUT = userTask.embeddedInfo;

    pendingEmbeddedInfoBox.removeAllContent?.();

    if (embededInfoUT?.type === "application") {
        if (!embededInfoUT.appInfo?.appName) {
            pendingEmbeddedInfoBox.addContent(
                new sap.m.MessageStrip({
                    text: "No app is configured for this task.",
                    type: "Information",
                    showIcon: true,
                }).addStyleClass("sapUiSmallMargin")
            );
        } else {
            pendingEmbeddedInfoBox.setBusy(true);

            try {
                const result = await AppCache.Load(embededInfoUT.appInfo.appName, {
                    parentObject: pendingEmbeddedInfoBox,
                    startParams: embededInfoUT.appInfo.startParams,
                });

                if (result?.error) {
                    throw new Error(result.error);
                }
            } catch (err) {
                console.error("Embedded app load failed", err);
                sap.m.MessageToast.show("Embedded app load failed: " + err.message);
                pendingEmbeddedInfoBox.addContent(
                    new sap.m.MessageStrip({
                        text: "Could not load the configured app for this task.",
                        type: "Information",
                        showIcon: true,
                    }).addStyleClass("sapUiSmallMargin")
                );
            } finally {
                pendingEmbeddedInfoBox.setBusy(false);
            }
        }
    }
})();