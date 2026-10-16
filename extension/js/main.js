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
      if (ok(cands[i], ["-c", "import importlib.util,sys;sys.exit(0 if importlib.util.find_spec('faster_whisper') else 1)"])) return cands[i];
    }
    for (i = 0; i < cands.length; i++) {
      if (ok(cands[i], ["--version"])) return cands[i];
    }
    return null;
  }

  var cachedPy = null;
  function getPython() {
    if (!cachedPy) cachedPy = findPython();
    return cachedPy;
  }

  var running = false, startTime = 0, timer = null, curProc = null, cancelled = false, lastStage = "";
  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  function paintStage() {
    $("stage").textContent = lastStage + "  |  decorrido " + fmt((Date.now() - startTime) / 1000);
  }
  function setRunning(on) {
    running = on;
    $("btnRun").disabled = on; $("btnCaps").disabled = on;
    if (on) $("prog").style.display = "block";
    $("btnCancel").style.display = on ? "block" : "none";
    if (on) {
      startTime = Date.now(); cancelled = false; lastStage = "Iniciando...";
      $("bar").value = 0; paintStage();
      timer = setInterval(paintStage, 1000);
    } else if (timer) { clearInterval(timer); timer = null; curProc = null; }
  }
  function endStage(txt) {
    lastStage = txt;
    $("stage").textContent = txt + "  |  total " + fmt((Date.now() - startTime) / 1000);
  }
  function setBar(pct, txt) {
    if (!isNaN(pct)) $("bar").value = pct;
    lastStage = txt; paintStage();
  }
  $("btnCancel").onclick = function () {
    if (!curProc) return;
    cancelled = true;
    log("Cancelando...");
    try {
      if (process.platform === "win32") {
        nodeRequire("child_process").spawn("taskkill", ["/pid", String(curProc.pid), "/T", "/F"]);
      } else { curProc.kill("SIGKILL"); }
    } catch (e) { log("Falha ao cancelar: " + e.message); }
  };

  function baseArgs(video) {
    var path = nodeRequire("path");
    var args = [path.join(extPath, "autocut_free.py"), video, "--mode", $("mode").value, "--track", $("track").value || "0"];
    if ($("mode").value === "silence") {
      args.push("--noise", $("noise").value || "auto", "--min-silence", $("minsil").value);
    } else {
      var ba = $("ba").value.split("/");
      args.push("--top", $("top").value, "--before", (ba[0] || "6"), "--after", (ba[1] || "4"));
    }
    return args;
  }

  // Roda o script Python com barra de progresso; chama onOk() se terminar sem erro.
  function runScript(args, onOk) {
    var py = getPython();
    if (!py) { log("Python não encontrado. Instale em python.org (marque 'Add to PATH')."); return; }
    setRunning(true);
    var cp = nodeRequire("child_process");
    var env = Object.assign({}, process.env, { PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" });
    var proc = cp.spawn(py[0], py.slice(1).concat(args), { env: env, windowsHide: true });
    curProc = proc;
    var buf = "";
    function handleLine(l) {
      l = l.replace(/\s+$/, "");
      if (!l) return;
      if (l.indexOf("@@") === 0) {
        var i = l.indexOf("|");
        setBar(parseInt(l.slice(2, i), 10), l.slice(i + 1));
      } else { log(l); }
    }
    proc.stdout.on("data", function (d) {
      buf += d;
      var parts = buf.split(/\r?\n/);
      buf = parts.pop();
      parts.forEach(handleLine);
    });
    proc.stderr.on("data", function (d) {
      String(d).split(/\r?\n|\r/).forEach(function (l) { if (l.trim()) log(l.trim()); });
    });
    proc.on("error", function (e) { log("Falha: " + e.message); setRunning(false); });
    proc.on("close", function (code) {
      setRunning(false);
      if (buf) handleLine(buf);
      if (cancelled) { endStage("Cancelado"); log("Cancelado."); return; }
      if (code !== 0) { endStage("Falhou - veja o log abaixo"); log("Terminou com erro (código " + code + ")."); return; }
      onOk();
    });
  }

  function imp(file) {
    var arr = JSON.stringify([file]).replace(/\\/g, "\\\\");
    return evalJSX("importFiles(" + JSON.stringify(arr) + ")");
  }

  function checkVideo() {
    var video = $("video").value.trim();
    if (!video) { log("Escolha um vídeo primeiro."); return null; }
    if (!nodeRequire("fs").existsSync(video)) { log("Arquivo não existe: " + video); return null; }
    return video;
  }

  // 1) Cortar (rapido: segundos) -> importa a sequencia
  $("btnRun").onclick = function () {
    var video = checkVideo(); if (!video) return;
    var parsed = nodeRequire("path").parse(video);
    var xml = nodeRequire("path").join(parsed.dir, parsed.name + "_autocut.xml");
    var seqName = parsed.name + "_autocut";
    log("Cortando...");
    runScript(baseArgs(video), function () {
      setBar(100, "Importando no Premiere...");
      imp(xml).then(function (res) {
        log("Sequência importada: " + res);
        if (!$("zoom").checked) return;
        var pct = parseFloat($("zoompct").value) || 112;
        return evalJSX("applyZoom(" + JSON.stringify(seqName) + "," + pct + ")").then(function (z) {
          log("Zoom: " + z);
        });
      }).then(function () {
        endStage("Concluído");
        log("Pronto. Para legendas, clique em 'Gerar legendas' (usa os mesmos cortes).");
      });
    });
  };

  // 2) Legendas (separado): refaz a analise (segundos) e transcreve so os trechos mantidos
  $("btnCaps").onclick = function () {
    var video = checkVideo(); if (!video) return;
    var path = nodeRequire("path"), fs = nodeRequire("fs");
    var parsed = path.parse(video);
    var srt = path.join(parsed.dir, parsed.name + "_autocut.srt");
    var seqName = parsed.name + "_autocut";
    try { fs.unlinkSync(srt); } catch (e) {}
    log("Gerando legendas (modelo " + $("model").value + ", " + $("dev").value + ")...");
    var args = baseArgs(video).concat(["--captions-only", "--model", $("model").value, "--device", $("dev").value]);
    runScript(args, function () {
      if (!fs.existsSync(srt)) { endStage("Sem legendas"); log("Nenhuma fala detectada nos trechos."); return; }
      setBar(100, "Aplicando legendas no Premiere...");
      imp(srt).then(function (r2) {
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
        endStage("Concluído");
      });
    });
  };
})();
