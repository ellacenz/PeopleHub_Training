var q = (oEvent.getParameter("newValue") || "").toLowerCase();
var binding = listTasks.getBinding("items");

if (q) {
    var filter = new sap.ui.model.Filter(
        "title",
        sap.ui.model.FilterOperator.Contains,
        q
    );

    binding.filter([filter]);
} else {
    binding.filter([]);
}
