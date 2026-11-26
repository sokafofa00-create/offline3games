precision mediump float;

// Plato setup
varying vec4 vAttrColor;
uniform vec4 uGlobalTint;
uniform vec2 uResolution;
uniform vec2 uDevice;
uniform vec2 uPointA;
uniform vec2 uPointB;
uniform float uTime;

void main (void) {
	vec4 fragColor = (vAttrColor * uGlobalTint);
	vec4 fragCoord = gl_FragCoord;

	// Draws a rectangle displaying uPointA and uPointB
	float pointAX = uPointA.x * uDevice.x;
	float pointAY = uPointA.y * uDevice.y;
	float pointBX = uPointB.x * uDevice.x;
	float pointBY = uPointB.y * uDevice.y;

	fragColor.r = 1.0;
	if (gl_FragCoord.x > pointAX && gl_FragCoord.x < pointBX) {
		fragColor.r = 0.0;
		fragColor.g = 1.0;
		if (gl_FragCoord.y > pointAY && gl_FragCoord.y < pointBY) {
			fragColor.g = 0.0;
			fragColor.b = 1.0;
		}
	}
	fragColor.a = 0.5;

	gl_FragColor = fragColor;
}
