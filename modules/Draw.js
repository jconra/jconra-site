function draw_circle(ctx, x, y, r, c) {
  ctx.beginPath();
  ctx.fillStyle = c;
  ctx.arc(x, y, r, 0, Math.PI*2);
  ctx.fill();
}

function draw_rect(ctx, x, y, w, h, c) {
  ctx.fillStyle = c;
  ctx.fillRect(x-w/2, y-h/2, w, h);
}

function draw_border(ctx, x, y, w, h, s, c) {
  ctx.strokeStyle = c;
  ctx.lineWidth = s;
  ctx.strokeRect(x-w/2, y-h/2, w, h);
}

function grid(ctx, x, y, row, col, w, h, gap, size, color) {
  let gw = (w-(gap*(col-1)))/col;
  let gh = (h-(gap*(row-1)))/row;
  for (let i=0; i<row; i++) {
    for (let j=0; j<col; j++) {
      draw_border(ctx, x-w/2+(gw+gap)*j+gw/2, y-h/2+(gh+gap)*i+gh/2, gw, gh, size, color); 
    }
  }
}

export { draw_circle, draw_rect, draw_border, grid }
