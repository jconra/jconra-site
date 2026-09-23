var canvas = document.getElementById("myCanvas");
var ctx = canvas.getContext("2d");
var cw = canvas.width = 800;
var ch = canvas.height = 600;
var img=document.getElementById("textures");
var playerpy=document.getElementById("player");
var k = {up:false,down:false,left:false,right:false,jump:false};

var LEVELWIDTH = 200;
var LEVELHEIGHT = 50;
var pos = {xF:0, yF:0, xG:0, yG:0};
var grid = [];
var edit = true;
var mouse = {x:0,y:0,down:false,xd:0,yd:0};
var paintTool = {x:0,y:0};
var player = {x:cw/2-20,y:0,f:0,vx:0,vy:0};
var count = 0;
var keys_down = [];
var player_textures = [];
var mouse_down = false;

for(var i=0, ilen = LEVELWIDTH; i<ilen; i++) {
  grid.push([]);
  for(var j=0, jlen = LEVELHEIGHT; j<jlen; j++) {
    grid[i].push(obj());
    }
  };

//And objects x and y are the coordinates on the png where the block is
function obj() {return {x:0,y:0,on:false};}

function main() {
  requestAnimationFrame(main);
  text = "";
  for (var i=0; i<keys_down.length; i++) text += keys_down[i] + "<br>";
  document.getElementById("debug").innerHTML = text;
  ctx.clearRect(0,0,cw,ch);
  drawBackground();
  drawSquares();
  processkeys_down();
  if (edit) {
    drawGrid();
    if (mouse.down) drawSBox();
    }
  else {
    count++;
    drawPlayer();
    }
  }
  

function drawPlayer(){
  //var animation_speed = (keys_down.length == 0)? 60:10;
  //if (count%animation_speed == 0) player.f++;
  //var dir = (keys_down.indexOf(65) > -1 || keys_down.indexOf(37) > -1)? 0:(keys_down.indexOf(68) > -1 || keys_down.indexOf(39) > -1)? 80:40;
  //var frame = (player.f%2 == 0)? 0:40;
  //ctx.drawImage(playerpy,dir,0+frame,40,40,player.x,ch-player.y,40,40);
  if (player_textures.length == 0) {
    ctx.font = "50px Arial";
    ctx.fillStyle = "black";
    ctx.fillText("P", player.x, ch-player.y)
    }
  }
  

function drawSquares() {
  var lvlLen = LEVELWIDTH - Math.floor(cw/32);
  var lvlHgt = LEVELHEIGHT;
  for (var i=0, leni=Math.floor(cw/32); i<=leni; i++) {
    for (var j=0, lenj=Math.floor(ch/30); j<=lenj; j++) {
      var x = (i+pos.xG < 0)? 0:(i+pos.xG >= lvlLen)? lvlLen-1:i+pos.xG;
      var y = (j+pos.yG < 0)? 0:(j+pos.yG >= lvlHgt)? lvlHgt-1:j+pos.yG;
      try{
      if (grid[x][y].on) drawImage(grid[x][y],i*32-pos.xF,ch-j*30-30+pos.yF);
      }catch(e){console.log(x+"  "+y);}
      }
    }
  }
  

function drawImage(obj,x,y) {
    ctx.drawImage(img,obj.x*32,obj.y*30,32,30,x,y,32,30);
  }
  

function drawBackground() {
  var grd=ctx.createLinearGradient(0,0,0,ch);
  grd.addColorStop(0,"rgb(50,50,200");
  grd.addColorStop(1,"rgb(150,150,255");
  ctx.fillStyle=grd;
  ctx.fillRect(0,0,cw,ch);
  }
  

function drawGrid() {
  ctx.lineWidth=1;
  ctx.strokeStyle = "black";
  ctx.fillStyle = "black";
  var x = 0, y = 0;
  while (x < cw+32) {
    line(x-pos.xF,0,x-pos.xF,ch);
    ctx.fillText(x/32+pos.xG+1,x-pos.xF+10,10);
    x+=32;
    }
  while (y < ch+30) {
    line(0,y+pos.yF,cw,y+pos.yF);
    y+=30;
    }
  }
  

function line(x1,y1,x2,y2) {
  ctx.beginPath();
  ctx.moveTo(x1,y1);
  ctx.lineTo(x2,y2);
  ctx.stroke();
  }
  

canvas.addEventListener('mousedown',onMouseDown);
function onMouseDown(e) {
  mouse.down = true;
  var rect = canvas.getBoundingClientRect();
  mouse.x = mouse.xd = e.clientX - rect.left;
  mouse.y = mouse.yd = e.clientY - rect.top;
  }
  

canvas.addEventListener('mousemove',onMouseMove);
function onMouseMove(e) {
  e.preventDefault();
  if (mouse.down == false) return;
  var rect = canvas.getBoundingClientRect();
  mouse.x = e.clientX - rect.left;
  mouse.y = e.clientY - rect.top;
  }
  

function getGridPos(x,y){
  var x = Math.floor((x+pos.xF)/32)+pos.xG;
  var y = Math.floor((y+pos.yF)/30)+pos.yG;
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (x > grid.length) x = grid.length-1;
  if (y > grid.length) y = grid.length-1;
  return {x:x, y:y};
  }
  

canvas.addEventListener('mouseup',onMouseUp);
function onMouseUp(e) {
  mouse.down = false;
  if (!edit) return;
  var rect = canvas.getBoundingClientRect();
  var s = getGridPos(mouse.xd, ch-mouse.yd);
  var e = getGridPos(e.clientX - rect.left, ch-(e.clientY - rect.top));
  var p = minMaxSort(s.x,s.y,e.x,e.y);
  for(var i=p.y1; i<=p.y2; i++) {
    for(var j=p.x1; j<=p.x2; j++) {
      var obj = grid[j][i];
      obj.x = paintTool.x;
      obj.y = paintTool.y;
      obj.on = true;
      if (paintTool.x == 2 && paintTool.y == 0) obj.on = false;
      }
    }
  }
  

function minMaxSort(x1,y1,x2,y2) {
  var sx,ex,sy,ey;
  if (x1 < x2){sx = x1; ex = x2;}
  else        {ex = x1; sx = x2;}
  if (y1 < y2){sy = y1; ey = y2;}
  else        {ey = y1; sy = y2;}
  return {x1:sx,y1:sy,x2:ex,y2:ey};
  }
  

function drawSBox() {
  var p = minMaxSort(mouse.x,mouse.y,mouse.xd,mouse.yd);
  ctx.strokeStyle="White";
  ctx.lineWidth=3;
  ctx.beginPath();
  ctx.rect(p.x1,p.y1,p.x2-p.x1,p.y2-p.y1);
  ctx.stroke();
  }
  

function rn(min,max){return Math.floor( Math.random()*((max+1)-min)+min);}

var sqpcan = document.getElementById("sqpicker");
var sqpctx = sqpcan.getContext("2d");
var sqpWidth = sqpcan.width = 96;
var sqpHeight = sqpcan.height = 210;
sqpcan.addEventListener('mousedown',sqpick);
function sqpick(e) {
  var rect = sqpcan.getBoundingClientRect();
  var x = Math.floor((e.clientX - rect.left)/32);
  var y = Math.floor((e.clientY - rect.top)/30);
  paintTool = {x:x,y:y};
  sqpctx.clearRect(0,0,96,210);
  sqpctx.drawImage(img,0,0,96,90);
  sqpctx.strokeStyle="White";
  sqpctx.lineWidth=3;
  sqpctx.beginPath();
  sqpctx.rect(x*32+1,y*30+1,30,28);
  sqpctx.stroke();
  }
  

function toggleEdit() {
  var button = document.getElementById("edit");
  var options = document.getElementById("options");
  var hScroll = document.getElementById("HScroll");
  var vScroll = document.getElementById("VScroll");
  edit = !edit;
  pos.xG = 0;
  pos.yG = 0;
  if (edit) {
    button.value = "Play";
    options.style["display"] = "block";
    hScroll.style["display"] = "block";
    vScroll.style["display"] = "block";
    }
  else {
    button.value = "Edit";
    options.style["display"] = "none";
    hScroll.style["display"] = "none";
    vScroll.style["display"] = "none";
    placeplayer();
    }
  button.blur();
  }
  
  
function blockEditor() {
  var color = [0,0,0], original = [0,0,0];
  var brush = 1;
  var brightness = 185;
  var editorDiv = document.createElement('div');
  document.body.appendChild(editorDiv);
  
  editorDiv.className = 'fatborders';
  editorDiv.style.width = '600px';
  editorDiv.style.left = window.innerWidth/2-300+'px';
  editorDiv.style.height = '400px';
  editorDiv.style.top = window.innerHeight/2-200+'px';
  
  editorCan = document.createElement('canvas');
  editorDiv.appendChild(editorCan);
  ectx = editorCan.getContext("2d");
  editorCan.width = 320;
  editorCan.height = 320;
  editorCan.style.position = 'relative';
  editorCan.style.left = '140px';
  editorCan.style.top = '80px';
  ectx.fillStyle = "white";
  ectx.fillRect(0,0,320,320);
  ectx.strokeStyle = "black";
  for (var i=0; i<32; i++) {
    ectx.beginPath();
    ectx.moveTo(0,i*10);
    ectx.lineTo(320,i*10);
    ectx.stroke();
    ectx.beginPath();
    ectx.moveTo(i*10,0);
    ectx.lineTo(i*10,320);
    ectx.stroke();
    }
    
  
  editorCan.addEventListener('mousedown', function(e) { mouse_down = true; });
  editorCan.addEventListener('mouseup', function(e) { mouse_down = false; });
  editorCan.addEventListener('mousemove', function(e) {
    if (mouse_down) {
      var rect = editorCan.getBoundingClientRect();
      var x = Math.floor((e.clientX-rect.left)/10)*10;
      var y = Math.floor((e.clientY-rect.top)/10)*10;
      ectx.fillStyle = "rgb(" + color[0] + "," + color[1] + "," + color[2] + ")";
      for (var i=0; i<brush; i++) {
        for (var j=0; j<brush; j++)
          ectx.fillRect(x+1+i*10, y+1+j*10,8,8);
        }
      }
    }
  );
    
    
  colorCan = document.createElement('canvas');
  editorDiv.appendChild(colorCan);
  cctx = colorCan.getContext("2d");
  colorCan.width = 80;
  colorCan.height = 330;
  colorCan.style.position = 'relative';
  colorCan.style.left = '-300px';
  colorCan.style.top = '80px';
  drawArrow(cctx, brightness);
  var k = 4.5;
  var r = 255, g = 0, b = 0, rm = 0, gm = k, bm = 0;
  cctx.fillStyle = 'rgb('+color[0]+','+color[1]+','+color[2]+')';
  cctx.fillRect(0,0,80,30);
  for (var i=0; i<270; i++) {
    if (i==45) {rm = -k; gm = 0;}
    if (i==90) {bm = k; rm = 0;}
    if (i==135) {gm = -k; bm = 0;}
    if (i==180) {rm = k; gm = 0;}
    if (i==225) {bm = -k; rm = 0;}
    r+=rm;
    g+=gm;
    b+=bm;
    cctx.fillStyle = "rgb(" + Math.floor(r) + "," + Math.floor(g) + "," + Math.floor(b) + ")";
    cctx.fillRect(0,50+i,20,1);
    cctx.fillStyle = "rgb(" + Math.floor(255*i/270) + "," + Math.floor(255*i/270) + "," + Math.floor(255*i/270) + ")";
    cctx.fillRect(40,50+i,20,1);
    }
  
  colorCan.addEventListener('mousedown', function(e) {
    var rect = colorCan.getBoundingClientRect();
    var x = e.clientX-rect.left;
    var y = e.clientY-rect.top;
    if (x < 60) original = cctx.getImageData(x,y,1,1).data
    else {
      cctx.fillStyle = "rgb(50,50,50)";
      cctx.fillRect(60,brightness-10,20,20);
      if (y > 320) y = 320;
      if (y < 50) y = 50;
      brightness = y;
      drawArrow(cctx,y);
      }
    var br = (x < 30 || x > 60)? (brightness-185)*1.7:0;
    color[0] = Math.floor(br + original[0]);
    color[1] = Math.floor(br + original[1]);
    color[2] = Math.floor(br + original[2]);
    cctx.fillStyle = 'rgb('+color[0]+','+color[1]+','+color[2]+')';
    cctx.fillRect(0,0,80,30);
    });
  
  
  brushCan = document.createElement('canvas');
  editorDiv.appendChild(brushCan);
  bctx = brushCan.getContext("2d");
  brushCan.width = 80;
  brushCan.height = 330;
  brushCan.style.position = 'relative';
  brushCan.style.left = '80px';
  brushCan.style.top = '90px';
  bctx.fillStyle = "rgb(" + color[0] + "," + color[1] + "," + color[2] + ")";
  bctx.fillRect(30,10,10,10);
  bctx.fillRect(25,40,20,20);
  bctx.fillRect(20,80,30,30);
  bctx.fillRect(15,140,40,40);
  
  brushCan.addEventListener('mousedown', function(e) {
    var rect = brushCan.getBoundingClientRect();
    var x = e.clientX-rect.left;
    var y = e.clientY-rect.top;
    if (y < 30) brush = 1;
    else if (y < 70) brush = 2;
    else if (y < 120) brush = 3;
    else brush = 4;
    });
  
  
  //editorDiv.id = 'test';
  //contents (using HTML) div.innerHTML = '<span class="msg">Hello world.</span>';
  //contents (using text) div.textContent = 'Hello world.';

  //div.parentNode.removeChild(div);
  }
  
function drawArrow(ctx, y) {
  ctx.fillStyle = "white";
  ctx.beginPath();
  ctx.moveTo(60,y);
  ctx.lineTo(70,y-10);
  ctx.lineTo(70,y-4);
  ctx.lineTo(80,y-4);
  ctx.lineTo(80,y+4);
  ctx.lineTo(70,y+4);
  ctx.lineTo(70,y+10);
  ctx.lineTo(60,y);
  ctx.fill();
  }


function placeplayer(n) {
  if (player.y > LEVELHEIGHT*30) return;
  var s = getGridPos(player.x+20,player.y-40);
  if(grid[s.x][s.y].on) {player.y += 5; placeplayer();}
  }


document.getElementById("HScroll").onmousemove = function(e){Xscroll(e);};
document.getElementById("VScroll").onmousemove = function(e){Xscroll(e);};

function Xscroll(e) {
  if (e.buttons == 0) return;
  var thisDiv = e.currentTarget;
  var slider = thisDiv.childNodes[1];
  var rect = thisDiv.getBoundingClientRect();
  var x = e.clientX - rect.left-30;
  var y = e.clientY - rect.top-30;
  if (thisDiv.id == "HScroll") {
    if (x > -20 && x < 760) {
      slider.style["left"] = x + "px";
      var lvlLen = LEVELWIDTH - Math.floor(cw/32);
      var percentage = x/750;
      var xG = Math.floor(lvlLen*percentage);
      if (xG < 0) {pos.xG = 0; pos.xF = 0;}
      else if (xG > lvlLen) {pos.xG = lvlLen; pos.xF = 0;}
      else {pos.xG = xG; pos.xF = (lvlLen*percentage-pos.xG)*32;}
      }
    }
  else if (y > -20 && y < 560) {
    slider.style["top"] = y + "px";
      var lvlHgt = LEVELHEIGHT - Math.floor(ch/30);
      var percentage = 1-(y/520);
      var yG = Math.floor(lvlHgt*percentage);
      if (yG < 0) {pos.yG = 0; pos.yF = 0;}
      else if (yG >= lvlHgt) {pos.yG = lvlHgt-1; pos.yF = 0;}
      else {pos.yG = yG; pos.yF = (lvlHgt*percentage-pos.yG)*30;}
    }
  }

window.addEventListener('keydown',function(e){if (keys_down.indexOf(e.keyCode) == -1) keys_down.push(e.keyCode);e.preventDefault();});
window.addEventListener('keyup',function(e){keys_down.splice(keys_down.indexOf(e.keyCode),1)});

function processkeys_down(){
  if (edit) {
  
    //left 65, 37
    if (keys_down.indexOf(65) > -1 || keys_down.indexOf(37) > -1) {
      pos.xF -= 10;
      if (pos.xF < 0) {pos.xF += 32; pos.xG--;}
      }
  
    //down 83, 40
    if (keys_down.indexOf(83) > -1 || keys_down.indexOf(40) > -1) {
      pos.yF -= 10;
      if (pos.yF < 0) {pos.yF += 30; pos.yG--;}
      }
      
    //right 68, 39
    if (keys_down.indexOf(68) > -1 || keys_down.indexOf(39) > -1) {
      pos.xF += 10;
      if (pos.xF >31) {pos.xF -= 32; pos.xG++;}
      }
      
    //up 87, 38
    if (keys_down.indexOf(87) > -1 || keys_down.indexOf(38) > -1) {
      pos.yF += 10;
      if (pos.yF > 29) {pos.yF -= 30; pos.yG++;}
      }
    var x = pos.xG/(LEVELWIDTH - Math.floor(cw/32))*750;
    var hScroll = document.getElementById("HScroll").childNodes[1].style["left"] = x + "px";
    var y = pos.yG/(LEVELHEIGHT - Math.floor(ch/30))*520;
    var vScroll = document.getElementById("VScroll").childNodes[1].style["bottom"] = y + "px";
      
    }
  else {
  
    //left 65, 37
    if (keys_down.indexOf(65) > -1 || keys_down.indexOf(37) > -1) {
      var p = getGridPos(player.x-1,player.y-30);
      player.vx -= 1;
      if (player.vx < -5) player.vx = -5;
      if (grid[p.x][p.y].on) player.vx = 0;
      pos.xF += player.vx;
      if (pos.xF < 0) {pos.xF += 32; pos.xG--;}
      }
    
    //right 68, 39
    if (keys_down.indexOf(68) > -1 || keys_down.indexOf(39) > -1) {
      var p = getGridPos(player.x+41,player.y-30);
      player.vx += 1;
      if (player.vx > 5) player.vx = 5;
      if (grid[p.x][p.y].on) player.vx = 0;
      pos.xF += player.vx;
      var lvlLen = LEVELWIDTH - Math.floor(cw/32);
      if (pos.xF > 31) {pos.xF -= 32; pos.xG++;}
      }
      
    var p = getGridPos(player.x+20,player.y-41);
    //space 32  Jump
    if (keys_down.indexOf(32) > -1 && grid[p.x][p.y].on) {
      player.vy = 15;
      pos.yF += player.vy;
      if (pos.yF > 29) {pos.yF -=30; pos.yG++;}
      }
    
    var p = getGridPos(player.x+20,player.y-41);
    //Gravity
    if (!(grid[p.x][p.y].on)) {
      player.vy -= 1;
      if (player.vy < -8) player.vy = -8;
      if (player.vy > 0) {
        var b = getGridPos(player.x+20,player.y+1);
        if (grid[b.x][b.y].on) player.vy = 0;
        }
      pos.yF += player.vy;
      if (pos.yF < 0) {pos.yF +=30; pos.yG--;}
      if (pos.yF > 29) {pos.yF -=30; pos.yG++;}
      }
    
    }
    
  }

main();