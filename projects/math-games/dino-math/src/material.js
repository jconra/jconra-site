import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    texture,
    uv,
    normalLocal,
    float,
    vec2,
    vec3,
    mix,
    smoothstep,
    abs,
    dot,
    uniform,
    cameraPosition,
    positionWorld,
    length,
    sub,
} from 'three/tsl';

export function createIslandMaterial(textures, densityMap, islandSize) {
    const material = new MeshStandardNodeMaterial();

    const uniforms = {
        tilingScale:      uniform(7.5),
        detailTilingScale: uniform(31.5),
        detailFadeStart:  uniform(13.0),
        detailFadeEnd:    uniform(44.0),
        sandHigh:         uniform(0.8),
        sandLow:          uniform(0.2),
        grassLow:         uniform(0.2),
        grassHigh:        uniform(1.0),
        grassFadeHigh:    uniform(4.5),
        grassFadeLow:     uniform(3.5),
        rockLow:          uniform(3.0),
        rockHigh:         uniform(4.5),
        slopeLow:         uniform(0.3),
        slopeHigh:        uniform(0.6),
        grassRoughness:   uniform(0.85),
        sandRoughness:    uniform(0.95),
        rockRoughness:    uniform(0.75),
        litterStrength:    uniform(1.55),
        litterBrightness:  uniform(2.35),
        litterTilingScale: uniform(4.75),
    };

    const islandSizeU = uniform(islandSize);

    const scaledUV = uv().mul(uniforms.tilingScale);
    const detailUV  = uv().mul(uniforms.detailTilingScale);

    const grassTex      = texture(textures.grass,      scaledUV);
    const sandTex       = texture(textures.sand,       scaledUV);
    const rockTex       = texture(textures.rock,       scaledUV);
    const leafLitterTex = texture(textures.leafLitter, uv().mul(uniforms.litterTilingScale));

    const grassDetailTex = texture(textures.grassDetail, detailUV);
    const sandDetailTex  = texture(textures.sandDetail,  detailUV);
    const rockDetailTex  = texture(textures.rockDetail,  detailUV);

    const worldPos   = positionWorld;
    const height     = worldPos.y;
    const worldNormal = normalLocal.normalize();
    const slope      = float(1.0).sub(abs(dot(worldNormal, vec3(0, 1, 0))));

    const densityUV = vec2(
        worldPos.x.div(islandSizeU).add(0.5),
        worldPos.z.div(islandSizeU).add(0.5)
    );
    const treeDensity = texture(densityMap, densityUV).r;

    const sandWeight  = smoothstep(uniforms.sandHigh, uniforms.sandLow, height);
    const grassWeight = smoothstep(uniforms.grassLow, uniforms.grassHigh, height)
        .mul(smoothstep(uniforms.grassFadeHigh, uniforms.grassFadeLow, height));
    const rockWeight  = smoothstep(uniforms.rockLow, uniforms.rockHigh, height);

    const slopeRock = smoothstep(uniforms.slopeLow, uniforms.slopeHigh, slope);

    const finalSand  = sandWeight.mul(float(1.0).sub(slopeRock));
    const finalGrass = grassWeight.mul(float(1.0).sub(slopeRock));
    const finalRock  = rockWeight.add(slopeRock).clamp(0, 1);

    const totalWeight = finalSand.add(finalGrass).add(finalRock).max(0.001);
    const normSand  = finalSand.div(totalWeight);
    const normGrass = finalGrass.div(totalWeight);
    const normRock  = finalRock.div(totalWeight);

    const baseColor = grassTex.rgb.mul(normGrass)
        .add(sandTex.rgb.mul(normSand))
        .add(rockTex.rgb.mul(normRock));

    const litterBlend    = treeDensity.mul(normGrass.add(normRock.mul(0.3))).mul(uniforms.litterStrength);
    const colorWithLitter = mix(baseColor, leafLitterTex.rgb.mul(uniforms.litterBrightness), litterBlend);

    const cameraDist  = length(sub(cameraPosition, worldPos));
    const detailBlend = float(1.0).sub(
        smoothstep(uniforms.detailFadeStart, uniforms.detailFadeEnd, cameraDist)
    );

    const detailColor = grassDetailTex.r.mul(normGrass)
        .add(sandDetailTex.r.mul(normSand))
        .add(rockDetailTex.r.mul(normRock));

    const detailFactor = mix(float(1.0), detailColor.mul(2.0), detailBlend.mul(0.4));
    const finalColor   = colorWithLitter.mul(detailFactor);

    material.colorNode = finalColor;

    const baseRoughness = uniforms.grassRoughness.mul(normGrass)
        .add(uniforms.sandRoughness.mul(normSand))
        .add(uniforms.rockRoughness.mul(normRock));
    material.roughnessNode = mix(baseRoughness, float(0.95), litterBlend);

    material.metalness = 0.0;

    return { material, uniforms };
}
