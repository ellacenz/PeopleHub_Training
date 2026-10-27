const dateFrom = toolLogFileFilterDateFrom.getDateValue();
const dateTo = toolLogFileFilterDateTo.getDateValue();

if (isInvalidDateRange(dateFrom, dateTo)) {
    sap.m.MessageToast.show('Date range is not correct. "From" date cannot be later than "To".');
    return;
}

loadUserTasks();
