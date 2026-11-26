precision mediump float;

// Plato setup
varying vec4 vAttrColor;
uniform vec4 uGlobalTint;
// uniform vec2 uResolution;
uniform vec2 uDevice;
uniform float uTime;
uniform float uDuration;
uniform float uEdge;
uniform float uReverse;

// https://www.shadertoy.com/view/lsKSWR

void main (void) {
	vec4 fragColor = (vAttrColor * uGlobalTint);
	vec4 fragCoord = gl_FragCoord;
	float normal = (uTime / uDuration);
	if (uReverse > 0.0) {
		normal = (1.0 - normal);
	}

	vec2 uv = (fragCoord.xy / uDevice.xy);
	uv *= (1.0 - uv.yx);

	float extend = (uEdge * normal);
	float vignette = pow(uv.x * uv.y * 15.0, extend);

	vec4 shaderColor = vec4(vignette);
	fragColor.a = (1.0 - shaderColor.a);

	gl_FragColor = fragColor;
}
