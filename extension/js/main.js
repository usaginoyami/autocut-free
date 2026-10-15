/* AutoCut Free - painel CEP para Premiere Pro */
(function () {
  var cs = new CSInterface();
  var nodeRequire = window.cep_node ? window.cep_node.require : (window.require || null);
  var $ = function (id) { return document.getElementById(id); };
  var logEl = $("log");

  function log(msg) {
    logEl.textContent += msg + "\n";
    logEl.scrollTop = logEl.scrollHeight;
  }

  function evalJSX(code) {
    return new Promise(function (resolve) { cs.evalScript(code, resolve); });
  }

  if (!nodeRequire) {
    log("ERRO: Node.js não habilitado no painel. Rode o install.bat de novo e reinicie o Premiere.");
  }

  var extPath = cs.getSystemPath(SystemPath.EXTENSION);

  $("mode").onchange = function () {
    var hl = this.value === "highlights";
    $("silenceOpts").style.display = hl ? "none" : "block";
    $("hlOpts").style.display = hl ? "block" : "none";
  };

  $("btnPick").onclick = function () {
    var r = window.cep.fs.showOpenDialogEx(false, false, "Escolha o vídeo", "", ["mp4", "mov", "mkv", "avi", "webm"]);
    if (r.err === 0 && r.data && r.data.length) $("video").value = r.data[0];
  };

  $("btnActive").onclick = function () {
    evalJSX("getSelectedClipPath()").then(function (p) {
      if (p && p !== "EvalScript error." && p !== "") { $("video").value = p; log("Clipe: " + p); }
      else log("Nenhum clipe selecionado na timeline.");
    });
  };

  // Retorna [comando, ...argsFixos]. Prefere um Python que ja tenha o faster-whisper (3.12 no Windows).
  function findPython() {
    var cp = nodeRequire("child_process");
    var cands = process.platform === "win32"
      ? [["py", "-3.12"], ["py", "-3.11"], ["py", "-3.13"], ["py"], ["python"], ["python3"]]
      : [["python3"], ["python"]];
    function ok(c, extra) {
      try {
        var r = cp.spawnSync(c[0], c.slice(1).concat(extra));
        return r.status === 0;
      } catch (e) { return false; }
    }
    var i;
    for (i = 0; i < cands.length; i++) {
      if (ok(cands[i], ["-c", "import faster_whisper"])) return cands[i];
    }
    for (i = 0; i < cands.length; i++) {
      if (ok(cands[i], ["--version"])) return cands[i];
    }
    return null;
  }

  $("btnRun").onclick = function () {
    var video = $("video").value.trim();
    if (!video) { log("Escolha um vídeo primeiro."); return; }
    var fs = nodeRequire("fs");
    var path = nodeRequire("path");
    if (!fs.existsSync(video)) { log("Arquivo não existe: " + video); return; }

    var py = findPython();
    if (!py) { log("Python não encontrado. Instale em python.org (marque 'Add to PATH')."); return; }

    var args = [path.join(extPath, "autocut_free.py"), video, "--mode", $("mode").value, "--track", $("track").value || "0"];
    if ($("mode").value === "silence") {
      args.push("--noise", $("noise").value || "auto", "--min-silence", $("minsil").value);
    } else {
      var ba = $("ba").value.split("/");
      args.push("--top", $("top").value, "--before", (ba[0] || "6"), "--after", (ba[1] || "4"));
    }
    if ($("caps").checked) args.push("--captions");

    $("btnRun").disabled = true;
    log("Processando... (legendas podem demorar)");
    var cp = nodeRequire("child_process");
    var proc = cp.spawn(py[0], py.slice(1).concat(args));
    var out = "";
    proc.stdout.on("data", function (d) { out += d; log(String(d).trim()); });
    proc.stderr.on("data", function (d) { log(String(d).trim()); });
    proc.on("error", function (e) { log("Falha: " + e.message); $("btnRun").disabled = false; });
    proc.on("close", function (code) {
      $("btnRun").disabled = false;
      if (code !== 0) { log("Terminou com erro (código " + code + ")."); return; }
      var parsed = path.parse(video);
      var xml = path.join(parsed.dir, parsed.name + "_autocut.xml");
      var srt = path.join(parsed.dir, parsed.name + "_autocut.srt");
      function imp(file) {
        var arr = JSON.stringify([file]).replace(/\\/g, "\\\\");
        return evalJSX("importFiles(" + JSON.stringify(arr) + ")");
      }
      var seqName = parsed.name + "_autocut";
      var hasSrt = $("caps").checked && fs.existsSync(srt);
      imp(xml).then(function (res) {
        log("Sequência importada: " + res);
        if (!$("zoom").checked) return;
        var pct = parseFloat($("zoompct").value) || 112;
        return evalJSX("applyZoom(" + JSON.stringify(seqName) + "," + pct + ")").then(function (z) {
          log("Zoom: " + z);
        });
      }).then(function () {
        if (!$("caps").checked) return;
        if (!hasSrt) { log("Sem legendas: nenhuma fala detectada nos trechos."); return; }
        return imp(srt).then(function (r2) {
          log("Legendas importadas: " + r2);
          return evalJSX("applyCaptions(" + JSON.stringify(seqName) + "," + JSON.stringify(srt) + ")");
        }).then(function (r3) {
          if (r3 === "ok") {
            log("Legendas aplicadas na sequência '" + seqName + "'.");
          } else {
            log("Não consegui aplicar as legendas sozinho: " + r3);
            log("Manual: arraste o .srt do painel Projeto para a timeline.");
            log("Arquivo: " + srt);
          }
        });
      });
    });
  };
})();
