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
    var dt = document.createElement("dt");
    dt.textContent = row[0];
    var dd = document.createElement("dd");
    dd.textContent = row[1];
    dl.appendChild(dt);
    dl.appendChild(dd);
  });
  box.appendChild(dl);
})();
