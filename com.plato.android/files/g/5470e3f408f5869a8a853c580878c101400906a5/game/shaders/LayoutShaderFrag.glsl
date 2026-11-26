precision mediump float;

varying vec4 vAttrColor;
uniform vec4 uGlobalTint;
uniform vec2 uResolution;
uniform vec2 uDevice;
uniform vec2 uPointA;
uniform vec2 uPointB;
uniform float uTime;

void main (void) {
	vec4 shaderColor = vAttrColor * uGlobalTint;
	// shaderColor.b = 1.0;
	shaderColor.a = 0.5;

	// Draws a rectangle displaying uPointA and uPointB
	float pointAX = uPointA.x * uDevice.x;
	float pointAY = uPointA.y * uDevice.y;
	float pointBX = uPointB.x * uDevice.x;
	float pointBY = uPointB.y * uDevice.y;

	shaderColor.r = 1.0;
	if (gl_FragCoord.x > pointAX && gl_FragCoord.x < pointBX) {
		shaderColor.r = 0.0;
		shaderColor.g = 1.0;
		if (gl_FragCoord.y > pointAY && gl_FragCoord.y < pointBY) {
			shaderColor.g = 0.0;
			shaderColor.b = 1.0;
		}
	}

	gl_FragColor = shaderColor;
}
