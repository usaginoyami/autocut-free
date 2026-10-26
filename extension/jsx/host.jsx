// AutoCut Free - ExtendScript (Premiere Pro)

function importFiles(jsonArr) {
  try {
    var files = eval("(" + jsonArr + ")");
    if (!app.project) { return "sem projeto aberto"; }
    var ok = app.project.importFiles(files, true, app.project.getInsertionBin(), false);
    return ok ? "ok" : "falhou";
  } catch (e) {
    return "erro: " + e;
  }
}

function getSelectedClipPath() {
  try {
    var seq = app.project.activeSequence;
    if (!seq) { return ""; }
    var sel = seq.getSelection();
    for (var i = 0; i < sel.length; i++) {
      if (sel[i].projectItem) {
        var p = sel[i].projectItem.getMediaPath();
        if (p) { return p; }
      }
    }
    return "";
  } catch (e) {
    return "";
  }
}


// ---- Legendas: acha o .srt importado e cria a faixa de legendas na sequencia ----
function _findItemByPath(bin, p) {
  var want = p.replace(/\\/g, "/").toLowerCase();
  for (var i = 0; i < bin.children.numItems; i++) {
    var it = bin.children[i];
    if (it.type === ProjectItemType.BIN) {
      var r = _findItemByPath(it, p);
      if (r) { return r; }
    } else {
      try {
        var mp = it.getMediaPath();
        if (mp && mp.replace(/\\/g, "/").toLowerCase() === want) { return it; }
      } catch (e) {}
    }
  }
  return null;
}

function applyCaptions(seqName, srtPath) {
  try {
    var seq = null;
    for (var i = 0; i < app.project.sequences.numSequences; i++) {
      if (app.project.sequences[i].name === seqName) { seq = app.project.sequences[i]; break; }
    }
    if (!seq) { return "sequencia '" + seqName + "' nao encontrada"; }
    app.project.openSequence(seq.sequenceID);
    var item = _findItemByPath(app.project.rootItem, srtPath);
    if (!item) { return "legenda nao encontrada no projeto"; }
    if (typeof seq.createCaptionTrack !== "function") { return "esta versao do Premiere nao suporta criar legendas por script"; }
    var fmt = (typeof Sequence.CAPTION_FORMAT_SUBTITLE !== "undefined") ? Sequence.CAPTION_FORMAT_SUBTITLE : 0;
    seq.createCaptionTrack(item, 0, fmt);
    return "ok";
  } catch (e) {
    return "erro: " + e;
  }
}


// ---- Zoom automatico: alterna a Escala (Movimento) entre 100% e X% nos clipes da V1 ----
function applyZoom(seqName, percent) {
  try {
    var seq = null;
    for (var i = 0; i < app.project.sequences.numSequences; i++) {
      if (app.project.sequences[i].name === seqName) { seq = app.project.sequences[i]; break; }
    }
    if (!seq) { return "sequencia '" + seqName + "' nao encontrada"; }
    app.project.openSequence(seq.sequenceID);
    var track = seq.videoTracks[0];
    var done = 0, total = track.clips.numItems;
    for (var c = 0; c < total; c++) {
      if (c % 2 === 0) { continue; }           // clipes pares ficam em 100%
      var clip = track.clips[c];
      var motion = null;
      for (var k = 0; k < clip.components.numItems; k++) {
        var comp = clip.components[k];
        var mn = "";
        try { mn = comp.matchName; } catch (e1) {}
        if (mn === "AE.ADBE Motion" || comp.displayName === "Motion" || comp.displayName === "Movimento") { motion = comp; break; }
      }
      if (!motion) { continue; }
      var scale = null;
      for (var p = 0; p < motion.properties.numItems; p++) {
        var dn = motion.properties[p].displayName;
        if (dn === "Scale" || dn === "Escala") { scale = motion.properties[p]; break; }
      }
      if (!scale) { scale = motion.properties[1]; }
      scale.setValue(percent, true);
      done++;
    }
    return done + " de " + total + " clipes com zoom de " + percent + "%";
  } catch (e) {
    return "erro: " + e;
  }
}


// ---- Legenda animada: poe o video com transparencia na V2, no inicio da sequencia ----
function placeOverlay(seqName, movPath) {
  try {
    var seq = null;
    for (var i = 0; i < app.project.sequences.numSequences; i++) {
      if (app.project.sequences[i].name === seqName) { seq = app.project.sequences[i]; break; }
    }
    if (!seq) { return "sequencia '" + seqName + "' nao encontrada"; }
    app.project.openSequence(seq.sequenceID);
    var item = _findItemByPath(app.project.rootItem, movPath);
    if (!item) { return "video da legenda nao encontrado no projeto"; }
    if (seq.videoTracks.numTracks < 2) {
      try {
        app.enableQE();
        var q = qe.project.getActiveSequence();
        q.addTracks(1, seq.videoTracks.numTracks, 0);
      } catch (e1) {}
    }
    if (seq.videoTracks.numTracks < 2) { return "a sequencia so tem a faixa V1 (nao consegui criar a V2)"; }
    var t = new Time();
    t.seconds = 0;
    seq.videoTracks[1].overwriteClip(item, t);
    return seq.videoTracks[1].clips.numItems > 0 ? "ok" : "o Premiere nao colocou o clipe na V2";
  } catch (e) {
    return "erro: " + e;
  }
}
