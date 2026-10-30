/* Nhân vật doodle (nét vẽ tay, tô mảng phẳng) dùng cho student.html và screen.html */
window.DOODLE = function (cls) {
  var ink = '#1b1b1b';
  return '<svg class="mascot ' + (cls || '') + '" viewBox="0 0 244 240" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" stroke-linejoin="round" stroke-linecap="round">' +
    // thân áo
    '<path d="M44 238 L46 176 Q48 150 80 144 L128 144 Q160 150 162 176 L164 238 Z" fill="#2c6e52" stroke="' + ink + '" stroke-width="4.5"/>' +
    '<path d="M96 144 L104 168 L112 144" fill="#8f1a38" stroke="' + ink + '" stroke-width="4"/>' +
    '<path d="M70 150 L96 144 L88 164 Z M138 150 L112 144 L120 164 Z" fill="#8f1a38" stroke="' + ink + '" stroke-width="4"/>' +
    // cổ + đầu
    '<rect x="92" y="124" width="24" height="24" rx="6" fill="#fde7d3" stroke="' + ink + '" stroke-width="4.5"/>' +
    '<ellipse cx="104" cy="92" rx="40" ry="42" fill="#fde7d3" stroke="' + ink + '" stroke-width="4.5"/>' +
    '<circle cx="64" cy="98" r="7" fill="#fde7d3" stroke="' + ink + '" stroke-width="4"/><circle cx="144" cy="98" r="7" fill="#fde7d3" stroke="' + ink + '" stroke-width="4"/>' +
    // mũ lưỡi trai
    '<path d="M62 84 Q64 40 104 38 Q144 40 146 84 Q104 74 62 84 Z" fill="#8f1a38" stroke="' + ink + '" stroke-width="4.5"/>' +
    '<path d="M60 84 Q106 70 166 88 Q158 100 108 94 Q76 92 60 84 Z" fill="#6b0f2a" stroke="' + ink + '" stroke-width="4.5"/>' +
    '<path d="M104 52 l4 9 10 1 -8 6 3 10 -9 -6 -9 6 3 -10 -8 -6 10 -1 z" fill="#fffdf8" stroke="' + ink + '" stroke-width="2.5"/>' +
    // mặt
    '<ellipse cx="88" cy="104" rx="3.6" ry="5" fill="' + ink + '"/><ellipse cx="120" cy="104" rx="3.6" ry="5" fill="' + ink + '"/>' +
    '<path d="M92 118 Q104 130 116 118" fill="none" stroke="' + ink + '" stroke-width="4"/>' +
    '<circle cx="80" cy="116" r="5" fill="#f4b6b6" opacity=".7"/><circle cx="128" cy="116" r="5" fill="#f4b6b6" opacity=".7"/>' +
    // tay phải giơ bảng điểm
    '<path d="M150 170 Q184 172 182 128" fill="none" stroke="' + ink + '" stroke-width="26"/><path d="M150 170 Q184 172 182 128" fill="none" stroke="#2c6e52" stroke-width="17"/>' +
    '<circle cx="182" cy="120" r="12" fill="#fde7d3" stroke="' + ink + '" stroke-width="4"/>' +
    '<g transform="translate(184 74) rotate(9)"><rect x="-32" y="-46" width="64" height="76" rx="5" fill="#fffdf8" stroke="' + ink + '" stroke-width="4.5"/>' +
    '<path d="M-22 -28 H22 M-22 -20 H8" stroke="#9aa59e" stroke-width="3"/>' +
    '<text x="0" y="12" text-anchor="middle" font-family="Itim,cursive" font-size="34" font-weight="700" fill="#8f1a38">10</text>' +
    '<path d="M22 -42 l3 7 7 1 -5 5 2 7 -7 -4 -7 4 2 -7 -5 -5 7 -1 z" fill="#e0a526" stroke="' + ink + '" stroke-width="2"/></g>' +
    // vạch chuyển động
    '<path d="M218 60 l10 -6 M222 78 h12 M216 96 l10 6" stroke="' + ink + '" stroke-width="3.5" fill="none"/>' +
    '</svg>';
};
