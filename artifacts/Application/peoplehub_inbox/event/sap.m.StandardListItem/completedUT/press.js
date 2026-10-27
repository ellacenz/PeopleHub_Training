(async () => {
    const item = oEvent.getSource();
    const userTask = item.getBindingContext("UserTasks").getObject();

    modelUserTasks.setProperty("/selectedItem", userTask);

    const embededInfoUT = userTask.embeddedInfo;
    const embeddedInfoUTType = userTask.embeddedInfo?.type;

    completedEmbeddedInfoBox.removeAllContent?.();
    completedEmbeddedInfoBox.setBusy(true);

    try {
        switch (embeddedInfoUTType) {
            case "application": {
                const result = await AppCache.Load(embededInfoUT.appInfo.appName, {
                    parentObject: completedEmbeddedInfoBox,
                    startParams: embededInfoUT.appInfo.startParams,
                });

                if (result?.error) {
                    throw new Error(result.error);
                }
                break;
            }
        }
    } catch (err) {
        console.error("Embedded app load failed", err);
        sap.m.MessageToast.show("Embedded app load failed: " + err.message);
    } finally {
        completedEmbeddedInfoBox.setBusy(false);
    }
})();