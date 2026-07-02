# Investigación: shimmer/serruchado en las barandas (material `M_Grid`)

Escena de prueba: `-OqfNdj16F_KE-TUCfQk`. El material afectado es `M_Grid`, una reja de listones cuyos huecos no están modelados como geometría sino generados por un *alpha-test cutout* (el canal alpha de la textura recorta los espacios entre listones). El síntoma es que los bordes de los listones se ven dentados —serruchados— y crawlean mientras se mueve la cámara. Las pruebas se hicieron en un monitor con `devicePixelRatio = 1` y perfil de calidad `high`.

## Qué probamos

Arrancamos pensando que era una textura decorativa con moiré, así que lo primero fue intentar **eliminar la textura y dejar un color sólido**. Para eso agregamos un toggle "Sin textura (color sólido)" en el panel de materiales. Eso reveló el primer dato importante: el `map` no es decorativo sino funcional —al quitarlo, la reja se convierte en un bloque sólido, porque la textura es la que define los huecos por alpha. Así que descartamos ese camino para M_Grid (aunque el toggle quedaba como feature útil para materiales que sí sean decorativos).

Reencuadrado el problema como aliasing del borde alpha-test, fuimos por la solución estándar para rejas y follaje: **MSAA más `alphaToCoverage`**. Activamos antialiasing real en el renderer (estaba hardcodeado en `false`) para los perfiles de desktop, y pusimos `alphaToCoverage` en los materiales con alpha-test. Confirmamos por consola que el MSAA quedaba realmente activo (`SAMPLES = 4`), pero el serruchado seguía igual.

Antes de seguir tocando a ciegas hicimos un **diagnóstico de la textura**. Los datos mostraron que el filtrado ya era óptimo: textura sin comprimir, con mipmaps generados, anisotropía en 8, filtrado trilinear, `alphaTest` en 0.5 y `alphaToCoverage` activo. Es decir, no era un problema de mipmaps, de anisotropía ni de KTX2, y el MSAA era genuino. Eso descartó toda la familia de causas de "filtrado de textura".

El siguiente razonamiento fue que el MSAA samplea la cobertura y la profundidad, pero no el *lookup* de la textura: el fragment shader corre una sola vez por pixel, así que el alpha promediado por mipmap se muestrea una única vez y "baila" con el movimiento sub-téxel de la cámara. Y con `devicePixelRatio = 1` no había nada de colchón. Entonces probamos **supersampling (SSAA)**: subimos el `pixelRatio` desacoplándolo del device pixel ratio y arreglamos de paso dos clamps que lo topaban al dpr —eso destrabó el slider "Antialiasing" del panel, que en la práctica estaba muerto en 1× para un monitor con dpr=1—. Aun forzando 2×, el serruchado persistió.

Después fuimos por una técnica más específica: **mipmaps que preservan la cobertura** (el enfoque de Ben Golus, equivalente al "Preserve Coverage" de Unity). La idea es que los mipmaps normales promedian el alpha y la cobertura al umbral deriva nivel a nivel, lo que hace que la reja "respire" al cambiar de mip. Regeneramos cada mip reescalando su alpha para igualar la cobertura del nivel 0; construyó nueve niveles correctamente. Pero tampoco cambió nada, y ahí surgió la aclaración clave: el serruchado se produce *mientras se mueve la cámara*, como un crawl del borde, no como un "respirar" al zoomear. Eso invalidó la hipótesis de deriva de cobertura.

El último intento del lado del render fue **pasar de alpha-test a alpha-blend**: eliminar el umbral duro y usar transparencia, de modo que los mipmaps filtren suave —nítido de cerca, tinte difuso a distancia— sin ningún escalón que serruche. Convertimos los materiales alpha-test a transparentes, con un alpha-test mínimo solo para descartar los huecos vacíos y que no escribieran profundidad. Tampoco resolvió el problema.

## Conclusión

Después de agotar MSAA, alphaToCoverage, SSAA, coverage-preserving mips y alpha-blend, quedó claro que esto es un **límite del asset, no del viewer**. Una textura calada de alta frecuencia sobre una superficie delgada, vista en movimiento y con `dpr=1`, es esencialmente el peor caso para el antialiasing en tiempo real, y ningún ajuste del lado del código lo resuelve de forma satisfactoria.

El fix correcto es en **modelado o export**, con dos opciones. La primera es reemplazar `M_Grid` por un material sólido simple sin textura calada: cero shimmer, lo más barato, pero la baranda pierde los huecos y se ve como un panel lleno (coincide con la idea inicial de "color fijo simple"). La segunda es modelar los listones como geometría real —barras extruidas en vez de un calado por alpha—: conserva los huecos abiertos y no hay textura que aliasee, y en ese caso el MSAA de desktop sí suaviza bien los bordes reales, porque es justamente el escenario donde MSAA funciona.

## Estado del código

Todos los cambios de viewer que se probaron durante la investigación fueron **revertidos**, porque el MSAA en una escena con splats bajaba demasiado los FPS. El código quedó igual que antes de empezar. Este documento queda solo como registro de lo intentado, para no volver a recorrer los mismos caminos.
