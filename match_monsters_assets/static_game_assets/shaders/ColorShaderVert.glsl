precision mediump float;
attribute vec2 aPosition;
attribute vec4 aColor;
attribute vec2 aTexture;
uniform mat4 uProjection;
uniform mat4 uTransform;
uniform vec4 uGlobalTint;
varying vec4 vAttrColor;
varying vec2 vTextureCoord;

void main (void) {
  gl_Position = uProjection * uTransform * vec4(aPosition.x, aPosition.y, 0.0, 1.0);
  vTextureCoord = aTexture;
  vAttrColor = aColor;
}
