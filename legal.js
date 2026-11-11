(function () {
  var s = window.CD_SELLER;
  if (!s) return;
  document.querySelectorAll("[data-seller]").forEach(function (el) {
    var key = el.getAttribute("data-seller");
    if (s[key] != null) el.textContent = s[key];
  });
  document.querySelectorAll("a.js-mail").forEach(function (a) {
    a.href = "mailto:" + s.email;
    if (!a.textContent.trim()) a.textContent = s.email;
  });
  document.querySelectorAll("a.js-wa").forEach(function (a) {
    a.href = s.whatsappUrl;
  });
  document.querySelectorAll("a.js-ig").forEach(function (a) {
    a.href = s.instagramUrl;
  });
  var copyBtn = document.getElementById("copyCayma");
  if (copyBtn) {
    copyBtn.addEventListener("click", function () {
      var pre = document.getElementById("caymaForm");
      if (!pre) return;
      var text = pre.innerText;
      var done = function () { copyBtn.textContent = "Kopyalandı"; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {});
      }
    });
  }
  function sellerBlank(v) {
    if (v == null) return true;
    var text = String(v).trim();
    return !text || /^\[.*\]$/.test(text) || text === "resmi kayıt tamamlanınca eklenecek";
  }
  var pre = document.getElementById("caymaForm");
  if (pre && s.unvan) {
    var extra = [
      ["Adres", s.adres],
      ["Vergi dairesi", s.vergiDairesi],
      ["Vergi numarası", s.vergiNo],
      ["MERSİS no", s.mersis]
    ].filter(function (row) { return !sellerBlank(row[1]); })
      .map(function (row) { return row[0] + ": " + String(row[1]).trim(); });
    if (extra.length) {
      pre.textContent = pre.textContent.replace(s.unvan + "\n", s.unvan + "\n" + extra.join("\n") + "\n");
    }
  }
  var box = document.getElementById("satici-kimlik");
  if (!box) return;
  var rows = [
    ["Unvan", s.unvan],
    ["Marka", s.marka],
    ["MERSİS no", s.mersis],
    ["Vergi dairesi", s.vergiDairesi],
    ["Vergi no", s.vergiNo],
    ["Adres", s.adres],
    ["Telefon", s.telefon],
    ["E-posta", s.email],
    ["KEP", s.kep],
    ["İnternet sitesi", s.siteLabel],
    ["Instagram", s.instagram],
    ["WhatsApp", s.whatsapp]
  ];
  var dl = document.createElement("dl");
  rows.forEach(function (row) {
    if (sellerBlank(row[1])) return;
    var dt = document.createElement("dt");
    dt.textContent = row[0];
    var dd = document.createElement("dd");
    dd.textContent = row[1];
    dl.appendChild(dt);
    dl.appendChild(dd);
  });
  box.appendChild(dl);
})();
