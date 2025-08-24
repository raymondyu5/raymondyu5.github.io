import { Car, clamp, wrapAngle } from './dynamics.js';

class RLCarOverlay {
  constructor() {
    this.isInitialized = false;
    this.car = null;
    this.target = { x: 0, y: 0, vx: 0, vy: 0 };
    this.mouse = { x: 0, y: 0 };
    this.session = null;
    this.canvas = null;
    this.ctx = null;
    this.carSprite = null;
    this.isEnabled = true;
    
    this.init();
  }

  async init() {
    // Create overlay canvas
    this.createOverlayCanvas();
    
    // Load car sprite
    this.loadCarSprite();
    
    // Initialize car
    this.initializeCar();
    
    // Load ONNX model
    await this.loadModel();
    
    // Setup mouse tracking
    this.setupMouseTracking();
    
    // Start animation loop
    this.startAnimation();
    
    // Add toggle button
    this.addToggleButton();
    
    this.isInitialized = true;
  }

  createOverlayCanvas() {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'rl-car-overlay';
    this.canvas.style.position = 'fixed';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.pointerEvents = 'none'; // Allow clicks through canvas
    this.canvas.style.zIndex = '9999';
    this.canvas.style.opacity = '0.9';
    
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    
    // Handle resize
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  resizeCanvas() {
    const DPR = Math.max(1, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(window.innerWidth * DPR);
    this.canvas.height = Math.floor(window.innerHeight * DPR);
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    this.ctx.scale(1/DPR, 1/DPR);
  }

  loadCarSprite() {
    this.carSprite = new Image();
    this.carSprite.src = 'libs/rl-car/car.svg';
  }

  initializeCar() {
    this.car = new Car({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      yaw: 0,
      v: 0,
      L: 48
    });
    
    this.target.x = this.car.x;
    this.target.y = this.car.y;
    this.mouse.x = this.car.x;
    this.mouse.y = this.car.y;
  }

  async loadModel() {
    try {
      // Load ONNX Runtime
      if (typeof ort === 'undefined') {
        await this.loadONNXRuntime();
      }
      
      this.session = await ort.InferenceSession.create('libs/rl-car/model.onnx', {
        executionProviders: ['wasm']
      });
      console.log('RL Car model loaded successfully!');
    } catch (e) {
      console.error('Failed to load RL car model:', e);
    }
  }

  async loadONNXRuntime() {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ort.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  setupMouseTracking() {
    document.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    });
    
    // Handle scrolling - adjust car position relative to viewport
    window.addEventListener('scroll', () => {
      // Keep car in viewport when scrolling
    });
  }

  updateTarget(dt) {
    // More aggressive target movement toward mouse for better responsiveness
    const kp = 15.0, kd = 2.0;  // Higher gain, lower damping
    const ax = kp * (this.mouse.x - this.target.x) - kd * this.target.vx;
    const ay = kp * (this.mouse.y - this.target.y) - kd * this.target.vy;
    
    this.target.vx += ax * dt;
    this.target.vy += ay * dt;
    
    // Higher velocity limit for faster following
    const maxV = 400;
    const sp = Math.hypot(this.target.vx, this.target.vy);
    if (sp > maxV) {
      this.target.vx *= maxV / sp;
      this.target.vy *= maxV / sp;
    }
    
    this.target.x += this.target.vx * dt;
    this.target.y += this.target.vy * dt;
    
    // Keep target in bounds
    this.target.x = clamp(this.target.x, 50, window.innerWidth - 50);
    this.target.y = clamp(this.target.y, 50, window.innerHeight - 50);
  }

  buildObservation() {
    // Build observation vector like in training
    const c = Math.cos(this.car.yaw), s = Math.sin(this.car.yaw);
    const dx = this.target.x - this.car.x;
    const dy = this.target.y - this.car.y;
    
    // Transform to car frame
    const x_rel = c * dx + s * dy;
    const y_rel = -s * dx + c * dy;
    
    // Relative velocity in world frame
    const vx_w = this.target.vx - this.car.v * c;
    const vy_w = this.target.vy - this.car.v * s;
    
    // Transform relative velocity to car frame
    const vx_rel = c * vx_w + s * vy_w;
    const vy_rel = -s * vx_w + c * vy_w;
    
    return new Float32Array([x_rel, y_rel, vx_rel, vy_rel, this.car.v]);
  }

  drawCar() {
    if (!this.ctx || !this.isEnabled) return;
    
    this.ctx.save();
    this.ctx.translate(this.car.x, this.car.y);
    this.ctx.rotate(this.car.yaw);
    
    const scale = 0.8; // Bigger for better visibility
    const w = 120 * scale, h = 60 * scale;
    
    if (this.carSprite && this.carSprite.complete) {
      this.ctx.drawImage(this.carSprite, -w/2, -h/2, w, h);
    } else {
      // Fallback rectangle (red to match new SVG)
      this.ctx.fillStyle = '#e01f1f';
      this.ctx.fillRect(-w/2, -h/2, w, h);
    }
    
    this.ctx.restore();
    
    // Draw subtle target indicator (red to match car)
    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(224, 31, 31, 0.3)';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.arc(this.target.x, this.target.y, 8, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.restore();
  }

  addToggleButton() {
    const button = document.createElement('button');
    button.innerHTML = '🚗';
    button.style.position = 'fixed';
    button.style.bottom = '20px';
    button.style.right = '20px';
    button.style.width = '50px';
    button.style.height = '50px';
    button.style.borderRadius = '50%';
    button.style.border = 'none';
    button.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
    button.style.color = 'white';
    button.style.fontSize = '24px';
    button.style.cursor = 'pointer';
    button.style.zIndex = '10000';
    button.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
    button.style.transition = 'all 0.3s ease';
    button.style.display = 'flex';
    button.style.alignItems = 'center';
    button.style.justifyContent = 'center';
    button.style.lineHeight = '1';
    
    // Create info tooltip
    const tooltip = document.createElement('div');
    tooltip.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 5px; color: #667eea;"> Car Agent Trained with RL!</div>
      <div style="font-size: 12px; line-height: 1.4;">
        This car was trained to follow your mouse using 
        <strong>Soft Actor-Critic</strong>.<br>
      </div>
    `;
    tooltip.style.position = 'fixed';
    tooltip.style.bottom = '80px';
    tooltip.style.right = '20px';
    tooltip.style.background = 'white';
    tooltip.style.padding = '12px 16px';
    tooltip.style.borderRadius = '12px';
    tooltip.style.boxShadow = '0 4px 20px rgba(0,0,0,0.15)';
    tooltip.style.border = '1px solid rgba(0,0,0,0.1)';
    tooltip.style.fontSize = '13px';
    tooltip.style.color = '#4a5568';
    tooltip.style.width = '220px';
    tooltip.style.zIndex = '10001';
    tooltip.style.opacity = '0';
    tooltip.style.transform = 'translateY(10px)';
    tooltip.style.transition = 'all 0.3s ease';
    tooltip.style.pointerEvents = 'none';
    
    button.addEventListener('click', () => {
      this.isEnabled = !this.isEnabled;
      this.canvas.style.display = this.isEnabled ? 'block' : 'none';
      button.style.opacity = this.isEnabled ? '1' : '0.5';
    });
    
    button.addEventListener('mouseenter', () => {
      button.style.transform = 'scale(1.1)';
      tooltip.style.opacity = '1';
      tooltip.style.transform = 'translateY(0)';
    });
    
    button.addEventListener('mouseleave', () => {
      button.style.transform = 'scale(1)';
      tooltip.style.opacity = '0';
      tooltip.style.transform = 'translateY(10px)';
    });
    
    document.body.appendChild(button);
    document.body.appendChild(tooltip);
  }

  startAnimation() {
    let last = performance.now();
    
    const tick = async (now) => {
      if (!this.isEnabled) {
        requestAnimationFrame(tick);
        return;
      }
      
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      
      // Update target movement
      this.updateTarget(dt);
      
      // Get RL agent action
      let steerCmd = 0, accelCmd = 0;
      if (this.session) {
        try {
          const obs = this.buildObservation();
          const tensor = new ort.Tensor('float32', obs, [1, obs.length]);
          const output = await this.session.run({ input: tensor });
          const action = output.action.data;
          
          steerCmd = action[0] * 0.6; // max_steer
          accelCmd = action[1] * 500; // max_accel
        } catch (e) {
          // Fallback to simple following if RL fails
          const dx = this.target.x - this.car.x;
          const dy = this.target.y - this.car.y;
          const dist = Math.hypot(dx, dy);
          const targetAngle = Math.atan2(dy, dx);
          const angleError = wrapAngle(targetAngle - this.car.yaw);
          
          steerCmd = clamp(angleError * 2, -0.6, 0.6);
          accelCmd = clamp(dist * 2, -100, 300);
        }
      }
      
      // Update car physics
      this.car.step(steerCmd, accelCmd, dt, {
        maxSteer: 0.6,
        maxAccel: 500
      });
      
      // Keep car in bounds
      this.car.x = clamp(this.car.x, 50, window.innerWidth - 50);
      this.car.y = clamp(this.car.y, 50, window.innerHeight - 50);
      
      // Clear and draw
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.drawCar();
      
      requestAnimationFrame(tick);
    };
    
    requestAnimationFrame(tick);
  }
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new RLCarOverlay();
  });
} else {
  new RLCarOverlay();
}

export { RLCarOverlay };
