var projects = [
  {
    src:"shipwrecked.JPG",
    link:"https://shipwrecked.jconra.com/",
    title:"Shipwrecked.us",
    text:"This is a game where you play a character that is trying to survive on an island. I use the three.js library to help with WebGL. I created all the models with Blender. It uses texture splatting, keyframe animation, shadowmaps, custom GLSL shaders, collusion detection, and many more techniques."
  },{
    src:"earth.JPG",
    link:"/projects/earth",
    title:"3D Earth",
    text:"This project uses maps provided by NASA in two ways. First, the satellite map of Earth is used as the texture. But, even before that, a map showing elevation was used to create the model so that mountains would be exaggerated. You can toggle parts of the scene and even attach the camera to a satellite to orbit the planet."
  },{
    src:"subnetCalc.JPG",
    link:"/projects/subnetCalc",
    title:"Subnetting Calculator",
    text:"This calculator is designed to help networking students learn about subnetting. It can ask questions and help you find the answer. I created this when I was a student at the US Air Force Cyber Warfare Operations School to help my classmates pass the class. It is still being used at the school to help students."
  },{
    src:"jeopardy.JPG",
    link:"/projects/jeopardy",
    title:"Jeopardy",
    text:"This was put together to replace a PowerPoint version of Jeopardy that was being used to help students review for tests at the US Air Force Cyber Warfare Operations School. It is easy to change the internal JSON object to give it new questions and answers."
  },{
    src:"tutorial.JPG",
    link:"/projects/duckcon",
    title:"HTML Games Tutorial",
    text:"This was created to help teach an Intro to Scripting presentation at DuckCon. DuckCon is a small event to get people thinking about network security. I have presented for Air Force members and High School students. This tutorial has several simple games I created on the last page including Missile Defense, Lander, and Rotator."
  },{
    src:"astar.JPG",
    link:"/projects/astar",
    title:"A* Algorithm",
    text:"This shows how the A* algorithm works by generating random maps and applying the pathfinding technique. You can play with it by clicking a start and destination for it. A third click will reset it. You can adjust the map size and have it step through it's execution so you can see exactly what it is doing."
  },{
    src:"digidraw.JPG",
    link:"/projects/effects",
    title:"Effects Page",
    text:"This is just for fun. Creating effects like these is sort of like working on a jigsaw puzzle for me. I imagine something and then figure out how to acctually code it."
  },{
    src:"kidGame.JPG",
    link:"/projects/kidGame",
    title:"2D Game Generator",
    text:"This application is still in progress, but it works well enough to let you design a level similar to older Mario games. You can create your character and play your level as you design it. The intent here is to allow people to create games and teach them about programming."
  },{
    src:"recurdraw.JPG",
    link:"/projects/recurdraw",
    title:"Recursive Drawing",
    text:"I created this to show a way that recursive algorithms can be used. You can tweak all the values to create a result, or simply hit the random buttom and you might be surprised!"
  }
];
  
var aboutData = [
  {
    x:0,y:0,h:150,w:150,
    text:"I am a software engineer with a background in network security. My current job is a Cyberspace Warfare Instructor for the US Air Force. However, I am planning on settling in the Seattle area in the fall. I love programming and I hope to find a company with an exciting mission for this next chapter of my life."
  },{ 
    x:0,y:200,h:50,w:50,
    title:"US Air Force",
    text:"I am a Technical Sergeant in the US Air Force. I am grateful to the Air Force and NSA for putting me through so much training. The Air Force has helped me become a better person by teaching me leadership skills and encouraging me to always improve myself physically and mentally."
  },{
    x:0,y:150,h:50,w:50,
    title:"Instructor",
    text:"My current job at Keesler AFB involves teaching Cyberspace Warfare Operations. I have gotten very comfortable getting up in front of groups and explaining difficult computer and networking concepts. My current classes are Windows, Linux and Scripting in Python, PowerShell, and Bash. In addition to keeping these skills solid, I am always getting better at public speaking and conveying technical information."
  },{
    x:200,y:100,h:50,w:50,
    title:"JavaScript",
    text:"JavaScript is my language of choice, and then probably english. I have been teaching myself JS for at least five years. I think it's awesome that I can sit down at any machine and bang out some JS without having to download any additonal software. I have experience using node.js, but usually I find myself trying to push client-side JS to its full potential. I am always excited to learn more!"
  },{ 
    x:150,y:100,h:50,w:50,
    title:"THREE.js",
    text:"I have become a huge fan of the THREE.js library. I love to work with code in three dimensions. WebGL is a fantastic technology that can bring any sort of experience to the browser that you can imagine. I am always trying to push my skills to the next level. My last project involved writting custom GLSL code, animation keyframes, texture splatting, shadowmaps, collision physics, and more."
  },{
    x:150,y:150,h:50,w:50,
    title:"HTML5",
    text:"I love web technology and I strive to master everything that HTML5 has to offer. I have spent countless hours using the canvas. I also enjoy playing with Websockets and AJAX to make dynamic pages."
  },{
    x:200,y:150,h:50,w:50,
    title:"Python",
    text:"Python is another great language that I have used for several work projects. It is my go-to language to quickly find a solution for problems involving lots of data and/or files."
  },{
    x:200,y:50,h:50,w:50,
    title:"Blender",
    text:"My attraction to 3D applications has given me lots of opportunities to use Blender to create 3D models with texture and animation."
  },{
    x:150,y:200,h:50,w:50,
    title:"Linux",
    text:"At my current job, one of my favorite classes to teach is Linux. The class teaches many skills that cyber operators need to know such as vim, regular expressions, /proc, package managers, iptables, cronjobs, investigating suspicious processes/connections, nfs, and much more."
  },{
    x:200,y:200,h:50,w:50,
    title:"Windows",
    text:"My work defending and attacking (as part of Red Team) the Department of Defense networks has given me plenty of experience on Windows Systems. I also teach a class on Windows."
  },{
    x:100,y:200,h:50,w:50,
    title:"PowerShell",
    text:"I have worked on several projects using PowerShell. For example, I made a client and server script that could transfer files that were encrypted and split into small pieces. This was useful to transfer files using a primitive php web-shell. I also teach PowerShell at my current job."
  },{
    x:100,y:150,h:50,w:50,
    title:"Electronics",
    text:"I love to bridge the gap between software and the physical world. I have experience using PIC Microcontrollers to control servos, motors, LEDs, and more. One of my favorite projects was making an electronic Star Wars style dog door. My dogs could activate a button that would start an opening, wait, and closing sequence. I also made a web-controlled dog treat dispenser and a programmable laser for my dogs to chase."
  },{
    x:50,y:150,h:50,w:50,
    title:"Avionics",
    text:"My first job in the Air Force was MQ-1 and MQ-9 (Predator and Reaper) avionics at Holloman AFB. This gave me experience replacing and troubleshooting avionics systems including KU-Band Satellite and C-Band Line-Of-Sight communications. I am comfortable with schematics and wiring diagrams."
  }
]
