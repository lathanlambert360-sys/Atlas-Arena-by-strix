import {useEffect,useRef,useState} from "react";
import * as THREE from "three";
import {Activity,Globe2,Pause,Play,RefreshCw,ShieldAlert} from "lucide-react";
import "./ThreatGlobe.css";

type Pos={lat:number;lon:number};
type GeoEvent={id:string;run:string;type:string;timestamp:string;source:Pos|null;target:Pos|null;point:Pos;label:string};
type Telemetry={source:string;received_at:string;events:GeoEvent[];count:number;synthetic_events:false};

function vector(p:Pos,r=2.02){
 const lat=THREE.MathUtils.degToRad(p.lat),lon=THREE.MathUtils.degToRad(p.lon);
 return new THREE.Vector3(-r*Math.cos(lat)*Math.cos(lon),r*Math.sin(lat),r*Math.cos(lat)*Math.sin(lon));
}
function isValid(p:Pos|null|undefined){
 return !!p&&Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180;
}
function GlobeScene({events,rotating}:{events:GeoEvent[];rotating:boolean}){
 const host=useRef<HTMLDivElement>(null);
 const groupRef=useRef<THREE.Group|null>(null);
 const sceneRef=useRef<THREE.Scene|null>(null);
 const autoRef=useRef(rotating);
 useEffect(()=>{autoRef.current=rotating},[rotating]);
 useEffect(()=>{
  const element=host.current;
  if(!element)return;
  let renderer:THREE.WebGLRenderer;
  try{renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:"high-performance"})}
  catch{return}
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  renderer.setSize(element.clientWidth,element.clientHeight||400);
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.25;
  element.append(renderer.domElement);
  const scene=new THREE.Scene();sceneRef.current=scene;
  const camera=new THREE.PerspectiveCamera(43,Math.max(1,element.clientWidth)/Math.max(1,element.clientHeight),.1,80);
  camera.position.set(0,.15,7.4);
  const earthGroup=new THREE.Group();scene.add(earthGroup);groupRef.current=earthGroup;
  const texture=new THREE.TextureLoader().load("./earth/earth-day.jpg");
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),8);
  const sphere=new THREE.Mesh(new THREE.SphereGeometry(2,96,72),new THREE.MeshPhongMaterial({map:texture,shininess:18,specular:new THREE.Color("#203c51"),color:"#dcefff"}));
  earthGroup.add(sphere);
  scene.add(new THREE.HemisphereLight("#bfdafa","#0b1a27",1.35));
  const sunlight=new THREE.DirectionalLight("#ffffff",3.1);
  sunlight.position.set(-4,2,6);scene.add(sunlight);
  const rim=new THREE.DirectionalLight("#3ddfc9",1.45);rim.position.set(3,-2,-4);scene.add(rim);
  const atmosphere=new THREE.Mesh(new THREE.SphereGeometry(2.14,80,64),new THREE.ShaderMaterial({
   vertexShader:"varying vec3 n;varying vec3 v;void main(){n=normalize(normalMatrix*normal);vec4 p=modelViewMatrix*vec4(position,1.0);v=normalize(-p.xyz);gl_Position=projectionMatrix*p;}",
   fragmentShader:"varying vec3 n;varying vec3 v;void main(){float h=pow(1.0-abs(dot(normalize(n),normalize(v))),3.0);gl_FragColor=vec4(0.09,0.59,0.83,h*0.28);}",
   transparent:true,side:THREE.FrontSide,depthWrite:false,blending:THREE.AdditiveBlending
  }));earthGroup.add(atmosphere);
  const stars=new Float32Array(480*3);
  for(let i=0;i<480;i++){const r=16+Math.random()*24,a=Math.random()*Math.PI*2,z=(Math.random()*2-1),s=Math.sqrt(1-z*z);stars[i*3]=r*s*Math.cos(a);stars[i*3+1]=r*z;stars[i*3+2]=r*s*Math.sin(a)}
  const starGeometry=new THREE.BufferGeometry();starGeometry.setAttribute("position",new THREE.BufferAttribute(stars,3));
  const starMaterial=new THREE.PointsMaterial({color:"#93c9db",size:.038,transparent:true,opacity:.55});
  const starPoints=new THREE.Points(starGeometry,starMaterial);scene.add(starPoints);
  let grabbing=false,oldX=0,oldY=0,frame=0;
  const down=(e:PointerEvent)=>{grabbing=true;oldX=e.clientX;oldY=e.clientY;renderer.domElement.setPointerCapture(e.pointerId)};
  const move=(e:PointerEvent)=>{if(!grabbing)return;earthGroup.rotation.y+=(e.clientX-oldX)*.006;earthGroup.rotation.x=Math.max(-.8,Math.min(.8,earthGroup.rotation.x+(e.clientY-oldY)*.004));oldX=e.clientX;oldY=e.clientY};
  const up=()=>{grabbing=false};
  const wheel=(e:WheelEvent)=>{e.preventDefault();camera.position.z=Math.max(4.6,Math.min(11,camera.position.z+Math.sign(e.deltaY)*.35))};
  renderer.domElement.addEventListener("pointerdown",down);
  renderer.domElement.addEventListener("pointermove",move);
  renderer.domElement.addEventListener("pointerup",up);
  renderer.domElement.addEventListener("pointercancel",up);
  renderer.domElement.addEventListener("wheel",wheel,{passive:false});
  const resize=()=>{const w=Math.max(1,element.clientWidth),h=Math.max(1,element.clientHeight);renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix()};
  const observer=new ResizeObserver(resize);observer.observe(element);
  const reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const animate=()=>{frame=requestAnimationFrame(animate);if(autoRef.current&&!grabbing&&!reduced)earthGroup.rotation.y+=.0007;renderer.render(scene,camera)};
  animate();
  return ()=>{
   cancelAnimationFrame(frame);observer.disconnect();
   renderer.domElement.removeEventListener("pointerdown",down);
   renderer.domElement.removeEventListener("pointermove",move);
   renderer.domElement.removeEventListener("pointerup",up);
   renderer.domElement.removeEventListener("pointercancel",up);
   renderer.domElement.removeEventListener("wheel",wheel);
   scene.traverse(obj=>{if(obj instanceof THREE.Mesh){obj.geometry.dispose();const mats=Array.isArray(obj.material)?obj.material:[obj.material];mats.forEach(m=>m.dispose())}});
   texture.dispose();starGeometry.dispose();starMaterial.dispose();renderer.dispose();renderer.domElement.remove();
   sceneRef.current=null;groupRef.current=null;
  };
 },[]);
 useEffect(()=>{
  const group=groupRef.current;if(!group)return;
  const old=group.getObjectByName("observed-events");
  if(old){group.remove(old);old.traverse(child=>{if(child instanceof THREE.Mesh||child instanceof THREE.Line){child.geometry.dispose();const mats=Array.isArray(child.material)?child.material:[child.material];mats.forEach(m=>m.dispose())}})}
  const markers=new THREE.Group();markers.name="observed-events";
  const good=events.filter(e=>isValid(e.point)).slice(0,250);
  for(const event of good){
   const pos=vector(event.point);
   const color=event.target?"#ff7f61":"#56edd4";
   const marker=new THREE.Mesh(new THREE.SphereGeometry(.025,10,8),new THREE.MeshBasicMaterial({color}));
   marker.position.copy(pos);markers.add(marker);
   if(isValid(event.source)&&isValid(event.target)&&event.source&&event.target){
    const a=vector(event.source,2.035),b=vector(event.target,2.035);
    const mid=a.clone().add(b).normalize().multiplyScalar(2.5);
    const points=new THREE.QuadraticBezierCurve3(a,mid,b).getPoints(48);
    const arc=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:"#64dfcd",transparent:true,opacity:.78}));
    markers.add(arc);
   }
  }
  group.add(markers);
  return ()=>{group.remove(markers);markers.traverse(child=>{if(child instanceof THREE.Mesh||child instanceof THREE.Line){child.geometry.dispose();const mats=Array.isArray(child.material)?child.material:[child.material];mats.forEach(m=>m.dispose())}})};
 },[events]);
 return <div className="tg-canvas" ref={host} role="img" aria-label="Interactive three-dimensional Earth with markers for actual recorded events containing geographic coordinates. Drag to rotate, scroll to zoom."/>;
}

export default function ThreatGlobe({compact=false}:{compact?:boolean}){
 const [data,setData]=useState<Telemetry|null>(null),[error,setError]=useState(""),[rotating,setRotating]=useState(true),[updated,setUpdated]=useState<number>(0);
 async function load(signal?:AbortSignal){
  try{
   const response=await fetch("/api/globe/telemetry",{credentials:"same-origin",cache:"no-store",signal});
   if(!response.ok)throw Error("Telemetry endpoint returned HTTP "+response.status);
   const value=await response.json() as Telemetry;
   if(!Array.isArray(value.events)||value.synthetic_events!==false)throw Error("Telemetry payload is not authenticated source data");
   setData(value);setError("");setUpdated(Date.now());
  }catch(e){if(!signal?.aborted)setError(String(e))}
 }
 useEffect(()=>{const ctrl=new AbortController();void load(ctrl.signal);const id=setInterval(()=>void load(ctrl.signal),12000);return()=>{clearInterval(id);ctrl.abort()}},[]);
 const count=data?.events.length||0;
 return <section className={"tg-frame "+(compact?"tg-compact":"")} aria-label="INFINITE Live Threat Globe">
   <header className="tg-head"><div><span className="tg-kicker"><Globe2 size={14}/> INFINITE / CYBERSPACE OBSERVATORY</span><h2>Live Threat Globe</h2><p>Photorealistic Earth · recorded geolocation telemetry only</p></div>
     <div className="tg-controls"><span className={"tg-feedstate "+(!error&&updated?"connected":"")}>{error?"Feed unavailable":updated?"Poll connected":"Connecting"}</span>
       <button title={rotating?"Pause globe rotation":"Resume globe rotation"} onClick={()=>setRotating(!rotating)}>{rotating?<Pause size={15}/>:<Play size={15}/>}</button>
       <button title="Refresh telemetry" onClick={()=>void load()}><RefreshCw size={15}/></button></div>
   </header>
   <div className="tg-stage"><GlobeScene events={data?.events||[]} rotating={rotating}/>
    <div className="tg-stage-label"><span className="tg-crosshair"/> EARTH / REAL-TIME RENDER</div>
    <div className="tg-legend"><span><i className="tg-pin source"/> observed source</span><span><i className="tg-pin target"/> observed target</span><small>Markers require actual coordinates</small></div>
   </div>
   <footer className="tg-bottom"><div><b><Activity size={14}/> {count} geolocated events</b><small>{data?.source||"Awaiting authenticated local telemetry"}</small></div>
     <div><b>{updated?new Date(updated).toLocaleTimeString():"—"}</b><small>Last successful poll · every 12 seconds</small></div></footer>
   {(error||!count)&&<div className="tg-note"><ShieldAlert size={16}/>{error?error:"No recorded events include geographic coordinates. The globe is real 3D; no attack markers or arcs are fabricated."}</div>}
   {!compact&&count>0&&<div className="tg-event-feed"><h3>Recorded location events</h3>{data?.events.slice(0,14).map(e=><div key={e.id}><span>{e.label}</span><small>{e.run} · {e.timestamp||"Unspecified time"}</small></div>)}</div>}
 </section>;
}
