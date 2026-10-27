sap.ui.require(["sap/ui/core/Core"], function (Core) {
    Core.ready().then(async () => {
        if (typeof PendingUT !== "undefined" && PendingUT.setLayoutData) {
            PendingUT.setLayoutData(new sap.ui.layout.SplitterLayoutData({ minSize: 400 }));
        }
        if (typeof PendingDetails !== "undefined" && PendingDetails.setLayoutData) {
            PendingDetails.setLayoutData(new sap.ui.layout.SplitterLayoutData({ minSize: 500 }));
        }
        if (typeof CompletedUT !== "undefined" && CompletedUT.setLayoutData) {
            CompletedUT.setLayoutData(new sap.ui.layout.SplitterLayoutData({ minSize: 400 }));
        }
        if (typeof CompletedUTDetails !== "undefined" && CompletedUTDetails.setLayoutData) {
            CompletedUTDetails.setLayoutData(new sap.ui.layout.SplitterLayoutData({ minSize: 500 }));
        }
        toolStartUpdate.firePress();
        modelPageHeaders.setData({
            text: "Process Flow Inbox Application",
            description: "Inbox for handling workflows",
            exportData: false,
        });
    });
});