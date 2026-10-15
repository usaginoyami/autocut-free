/* Shim mínimo do CSInterface (só o que o painel AutoCut Free usa). */
var SystemPath = { EXTENSION: "extension" };

function CSInterface() {}

CSInterface.prototype.evalScript = function (script, callback) {
  if (callback === null || callback === undefined) { callback = function () {}; }
  window.__adobe_cep__.evalScript(script, callback);
};

CSInterface.prototype.getSystemPath = function (pathType) {
  var path = decodeURI(window.__adobe_cep__.getSystemPath(pathType));
  if (navigator.userAgent.indexOf("Windows") >= 0) {
    path = path.replace("file:///", "");
  } else {
    path = path.replace("file://", "");
  }
  return path;
};
