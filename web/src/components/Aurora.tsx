import { useEffect, useRef } from "react";

import { cn } from "../styles";

const VERTEX = "attribute vec2 corner; void main() { gl_Position = vec4(corner, 0.0, 1.0); }";

// Two warped sine fields: one picks the colour between the bar's blue and cyan, the other how much
// of it shows, so the light drifts and thins out instead of covering the box.
const FRAGMENT = `
precision highp float;
uniform vec2 size;
uniform float time;
void main() {
  vec2 p = gl_FragCoord.xy / size.y * 1.6;
  float t = time * 0.18;
  p += 0.6 * sin(p.yx * 1.7 + t * vec2(1.3, 1.1));
  p += 0.4 * sin(p.yx * 2.3 - t * vec2(0.7, 1.7));
  vec3 colour = mix(vec3(0.114, 0.435, 0.984), vec3(0.455, 0.882, 1.0), 0.5 + 0.5 * sin(p.x + p.y + t));
  float alpha = smoothstep(0.15, 0.95, 0.5 + 0.5 * sin(p.x * 1.3 - p.y * 0.8 - t * 1.4));
  gl_FragColor = vec4(colour * alpha, alpha);
}`;

/** Drifting blue light drawn by a shader, filling its positioned parent behind the content. It
 * holds one still frame for people who turn motion off, and draws nothing without WebGL. */
export function Aurora({ className }: { className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    const gl = element?.getContext("webgl");
    if (!element || !gl) return;
    const program = gl.createProgram();
    for (const [type, source] of [
      [gl.VERTEX_SHADER, VERTEX],
      [gl.FRAGMENT_SHADER, FRAGMENT],
    ] as const) {
      const shader = gl.createShader(type);
      if (!shader) return;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    // biome-ignore lint/correctness/useHookAtTopLevel: a WebGL call, not a React hook
    gl.useProgram(program);
    // One triangle large enough to cover the whole canvas.
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const corner = gl.getAttribLocation(program, "corner");
    gl.enableVertexAttribArray(corner);
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
    const size = gl.getUniformLocation(program, "size");
    const time = gl.getUniformLocation(program, "time");

    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const started = performance.now();
    let frame = 0;
    const draw = (now: number) => {
      // The picture is all blur, so one canvas pixel per CSS pixel is enough on any screen.
      if (element.width !== element.clientWidth || element.height !== element.clientHeight) {
        element.width = element.clientWidth;
        element.height = element.clientHeight;
        gl.viewport(0, 0, element.width, element.height);
      }
      gl.uniform2f(size, element.width, element.height);
      gl.uniform1f(time, (now - started) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!still) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <canvas
      ref={canvas}
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 size-full", className)}
    />
  );
}

/** The light a card carries while work runs in it: it fills the card from the top and fades out
 * down it. The card takes `liveCard`, which keeps the light behind its content. */
export function LiveLight() {
  return (
    <Aurora className="-z-10 animate-fade rounded-[inherit] opacity-30 [mask-image:linear-gradient(to_bottom,black,transparent_14rem)] motion-reduce:animate-none" />
  );
}
