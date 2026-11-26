precision mediump float;

attribute vec2 aPosition;
attribute vec2 aUV;
attribute vec4 aColor;
attribute float aTime;

uniform mat4 uProjection;
uniform mat4 uTransform;

varying vec2 vUV;
varying vec4 vColor;
varying float vTime;

void main (void) {
    gl_Position = uProjection * uTransform * vec4(aPosition.x, aPosition.y, 0.0, 1.0);
    vUV = aUV;
    vColor = aColor;
    vTime = aTime;
}
