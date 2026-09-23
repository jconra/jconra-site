var grid, gw, gh;

self.addEventListener('message', function(e) {
  if (e.data.data != undefined) {
    grid = e.data.data;
    gh = grid.length;
    gw = grid[0].length;
  }
  for( var i=0; i<e.data.num; i++) {
    var p1 = {x:rn(3,gw-2),y:rn(3,gh-2)};
    var path = traceFromP(p1);
    if (path.length < 2) continue;
    else {
      self.postMessage(path);
      markGrid(path);
    }
  }  
}, false );

function traceFromP(p1) {
  var count = 0;
  do {
    var p2 = {x:p1.x+rn(-40,40),y:p1.y+rn(-15,15)};
    count += 1;
    if (count > 10) {console.log(count); return [];}
  } while (p2.x < 2 || p2.x > (gw-2) || p2.y < 2 || p2.y > (gh -2))
  var path = pathFind(p1,p2);   
  return path;
}

//This function marks the grid array with the path so future paths will see it
function markGrid(path) {
  for (var i=0, len=path.length; i<len; i++) {
    grid[path[i].y][path[i].x]=1;
  }
  var x1 = path[0].x, y1 = path[0].y;
  var x2 = path[path.length-1].x, y2 = path[path.length-1].y;
  for(var i=-1; i<2; i++) {
    for(var j=-1; j<2; j++) {
      if (y1+i >= 0 && y1+i < gh && x1+j >= 0 && x1+j <gw) grid[y1+i][x1+j]=1;
      if (y2+i >= 0 && y2+i < gh && x2+j >= 0 && x2+j <gw) grid[y2+i][x2+j]=1;
    }
  }
}

function pathFind(p1,p2){
  var openlist = [p1];
  var x, y, cost, pcost;
  var pts = {x:-1,y:-2};
  data = [];
  for (var i=0, ilen=grid.length; i<ilen; i++) { 
    data.push([]);
    for (var j=0, jlen=grid[0].length; j<jlen; j++) 
      data[i].push({status:0, weight:0, parent:{x:p1.x,y:p1.y}});
  }
  while (openlist.length>0){
    var lowestWeight=Infinity;
    var index=-1;
    var distanceWeight = 10;
    for (var i=0, ilen=openlist.length; i<ilen; i++){
      var n = data[openlist[i].y][openlist[i].x];
      var lw = n.weight+dist(openlist[i],p2)*distanceWeight;
      if (lw < lowestWeight){
        lowestWeight = lw;
        index = i;
      }
    }
    pts = openlist[index];
    data[pts.y][pts.x].status = 2;
    var parent = data[pts.y][pts.x].parent
    openlist.splice(index,1);
    pcost = ((parent.x-pts.x == 0)||(parent.y-pts.y == 0))? 10:16;
    for (var y=-1;y<2;y++){
      for (var x=-1;x<2;x++){
        if (x==0 && y==0) continue;
        cost = ((x==0)||(y==0))? 10:16;                     
        if (pts.y+y < 0 || pts.y+y > grid.length-1 || pts.x+x < 0 || pts.x+x > grid[0].length-1) continue;
        if (grid[pts.y+y][pts.x+x]==0){
        if (grid[pts.y][pts.x+x]==1 && grid[pts.y+y][pts.x]==1) continue;
          if (data[pts.y+y][pts.x+x].status == 0) {
            openlist.push({y:pts.y+y,x:pts.x+x});
            data[pts.y+y][pts.x+x] = {status:1, 
                                      weight:data[pts.y][pts.x].weight+cost, 
                                      parent:{y:pts.y,x:pts.x}}
          }
          else if (data[pts.y+y][pts.x+x].weight+cost < data[parent.y][parent.x].weight+pcost) {  
            data[pts.y][pts.x].parent = {y:pts.y+y,x:pts.x+x};
            data[pts.y][pts.x].weight = data[pts.y+y][pts.x+x].weight+cost;
          }
        }
      }
    }
    if (data[pts.y][pts.x].weight > 300) break;
    if ((pts.y == p2.y)&&(pts.x == p2.x)) break; 
  }

  path = [];
  while ((pts.y != p1.y)||(pts.x != p1.x)){
    path.push({y:pts.y,x:pts.x});
    pts = data[pts.y][pts.x].parent;
  }
  return path;
}

function rn(min,max){return Math.floor( Math.random()*(max-min)+min);}
function dist(p1,p2) {return Math.sqrt(Math.pow(p1.x-p2.x,2)+Math.pow(p1.y-p2.y,2));}
