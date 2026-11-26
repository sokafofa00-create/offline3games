precision mediump float;

uniform sampler2D uTexture;
uniform float uGreyScale;
uniform float uAlpha;
varying vec2 vTextureCoord;

void main(void) {
    vec4 ownColor = texture2D(uTexture, vTextureCoord);
    vec4 newColor = vec4(vec3(dot(ownColor.rgb, vec3(uGreyScale))) * ownColor.a, ownColor.a);
    gl_FragColor = vec4(newColor.rgb * uAlpha, ownColor.a * uAlpha);
}
