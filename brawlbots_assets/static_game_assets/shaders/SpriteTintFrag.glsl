precision mediump float;

uniform sampler2D uTexture;
uniform vec4 uColor;
varying vec2 vTextureCoord;

void main(void) {
    vec4 ownColor = texture2D(uTexture, vTextureCoord);
    gl_FragColor = vec4(uColor.rgb * ownColor.a, ownColor.a);
}
