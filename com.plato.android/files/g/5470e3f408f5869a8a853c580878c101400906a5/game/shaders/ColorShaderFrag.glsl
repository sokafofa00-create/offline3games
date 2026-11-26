precision mediump float;

varying vec2 vTextureCoord;
uniform sampler2D uTextureSampler;
varying vec4 vAttrColor;
uniform vec4 uGlobalTint;
uniform vec2 uResolution;
uniform vec4 uColor;
uniform float uTime;
uniform float uDuration;
uniform float uReverse;
uniform float uAlphaCap;

void main (void) {
	vec4 shaderColor = vAttrColor * uGlobalTint;
	vec4 textureColor = texture2D(uTextureSampler, vTextureCoord);
	float gray = (textureColor.r + textureColor.g + textureColor.b) / 3.0;
	/*
	// Desaturate
	vec4 grayColor = vec4(gray, gray, gray, textureColor.a);
	vec4 shaderColor = grayColor;
	*/

	// Color any pixels with non-alpha data
	if (textureColor.a >= uAlphaCap) {
	  float normal = uTime / uDuration;
		if (uReverse > 0.0) {
			normal = 1.0 - normal;
		}
		shaderColor.r = uColor.r * normal;
		shaderColor.g = uColor.g * normal;
		shaderColor.b = uColor.b * normal;

		/*
		shaderColor.r = uColor.r;
		shaderColor.g = uColor.g;
		shaderColor.b = uColor.b;
		*/
		// shaderColor.a = uColor.a;

		shaderColor.a = normal;
	}

	gl_FragColor = shaderColor;
}
