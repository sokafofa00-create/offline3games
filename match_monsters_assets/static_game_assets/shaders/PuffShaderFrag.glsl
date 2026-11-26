precision mediump float;

// Plato setup
varying vec4 vAttrColor;
varying vec2 vUV;
varying vec4 vColor;
varying float vTime;

vec3 circle (vec2 uv, float f) {

    float c = smoothstep(f , f*.4, .8*length(uv)) ;
    vec3 col1 = .65*vec3(c) * (1.-f);

    float c1 = smoothstep(f , f*.25, .8*length(uv)) ;
    // original code was doing a fancy thing with the supplied color
    // set blue and alpha to 1 regardless.
    vec3 col0 = vec3(vColor.gr, 1.) * c1 * (1.-f);

    return col1+col0;
}

void main (void) {
	vec3 circleColor = circle( 2.*vUV-vec2(1.), clamp(vTime, 0., 1.) );
	gl_FragColor = vec4(2. * circleColor, 0.);
}
