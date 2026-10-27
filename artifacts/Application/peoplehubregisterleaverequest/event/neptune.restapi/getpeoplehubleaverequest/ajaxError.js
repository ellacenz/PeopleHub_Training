let errorMsg = 'An error occurred while loading the leave requests.';
if (xhr && xhr.responseJSON && xhr.responseJSON.message) {
  errorMsg = xhr.responseJSON.message;
}
sap.m.MessageToast.show(errorMsg);