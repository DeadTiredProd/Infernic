import * as THREE from 'https://unpkg.com/three@0.149.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.149.0/examples/jsm/controls/OrbitControls.js';
import { OBJLoader } from 'https://unpkg.com/three@0.149.0/examples/jsm/loaders/OBJLoader.js';

let container, camera, renderer;

document.addEventListener("DOMContentLoaded", function () {
  container = document.getElementById('model-viewer');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeeeeee);

  camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / container.clientHeight,
    0.1,
    1000
  );
  camera.position.set(0, 5, 10);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
  directionalLight.position.set(10, 10, 10);
  scene.add(directionalLight);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.update();

  const loader = new OBJLoader();
  loader.load('/static/models/machine.obj', (obj) => {
    obj.scale.set(1, 1, 1);

    obj.traverse(function (child) {
      if (child instanceof THREE.Mesh) {
        child.geometry.computeBoundingBox();
        const center = new THREE.Vector3();
        child.geometry.boundingBox.getCenter(center);
        child.position.sub(center);
      }
    });

    scene.add(obj);
  }, undefined, (error) => {
    console.error("Failed to load OBJ:", error);
  });

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }

  animate();
});
