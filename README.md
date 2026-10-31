# TMR web 1.19.8 — Saques

Saques se suma a Multibolas y Reboteador con rotación, estadísticas y nota única. Formato JSON 8: restaurar copias nuevas solo en TMR 1.19.8 o superior; admite copias anteriores. APK pendiente.

# TMR web 1.19.7 — Multibolas y Reboteador

Actividades compartibles en una sesión, incompatibles con pareja y con estadísticas individuales. Formato JSON 7: las versiones anteriores no deben importar copias nuevas; se aceptan copias anteriores. APK pendiente.

# TMR web 1.19.6 — asistencia compacta y puntajes separados

Prueba web: filas compactas, sin Todos presentes y puntajes opcionales en pantalla propia. Los datos y formato JSON 6 se conservan. APK pendiente.

# TMR web 1.19.5 — pantallas más limpias

Se quitaron explicaciones de uso; se conservan avisos de seguridad, errores, cambios pendientes y datos de respaldo. Las funciones y el formato de datos continúan iguales.

# TMR web 1.19.4 — menú lateral

Versión web de prueba: menú lateral, escudo centrado y navegación inferior retirada. Las secciones y sus datos se conservan; puntajes separados y actividades Multibolas/Reboteador se implementarán en etapas posteriores. APK instalada continúa en 1.19.2.

# TMR — Entrenamientos del club

Web 1.19.3 · Biblioteca de ejercicios y ejercicios en el plan del entrenamiento. Incluye puntajes, estadísticas por compañero y diseño oscuro aprobado.
Este paquete contiene la web 1.19.3 corregida. La APK instalada sigue en 1.19.2; esta versión web está en revisión antes de generar otra APK. no publica ni actualiza automáticamente Netlify, Sites o el artifact. La instalación y las pruebas en el teléfono quedan a cargo del usuario.

## Biblioteca de ejercicios

- Más → Ejercicios: alta, edición, búsqueda (sin distinguir mayúsculas ni tildes) y filtro por categoría.
- Cada ejercicio tiene título (obligatorio), objetivo, descripción, duración en minutos, hasta 5 categorías e imagen opcional.
- En Lista → Plan del entrenamiento, «Agregar ejercicio» elige ejercicios de la biblioteca. El plan guarda solo sus identificadores: editar un ejercicio actualiza todos los planes donde aparece.
- Eliminar un ejercicio pide confirmación, indica cuántos planes lo usan y lo quita de esos planes. Las asistencias, parejas y notas no cambian.
- La biblioteca empieza vacía. Los datos quedan en este celular y se respaldan con la copia JSON (formato 6).

## Puntuar un entrenamiento

En Asistencia, elegí turno y fecha, marcá presente y tocá Puntuar. Elegí un entero de 1 a 10 o quitá la nota. Tocá Guardar asistencia para confirmar tanto marcas como puntajes. Puntuar es opcional: una clase sin nota no cuenta como cero. Si se guarda al jugador ausente o se quita de esa fecha, su nota de ese entrenamiento se elimina.

Inicio ya no muestra el bloque Rendimiento del mes, por preferencia del usuario. Estadísticas muestra el promedio individual y la cantidad de clases puntuadas/presentes del mes y turno elegido. En la ficha del jugador, Con quién entrena cuenta las parejas registradas y calcula el promedio de las notas de ESE jugador cuando entrenó con cada compañero. Puede elegirse todo el historial o un mes, y todos los turnos o el turno actual. No es una nota del dúo. Se excluyen clases canceladas, futuras, fuera de lunes/miércoles/viernes y parejas inválidas o no presentes. Las parejas antiguas cuentan aunque no tengan nota.

El tema oscuro y la tipografía local más grande se aplican a las pantallas reales. En móvil: Inicio, Lista, Plantel, Tiempo y Más; Parejas, Estadísticas, Historial y Configuración están en Más. La biblioteca de ejercicios sigue pendiente. La maqueta histórica queda en los respaldos anteriores; este paquete contiene la aplicación operativa.

## Agregar un invitado

1. Abrí Asistencia y elegí el turno y la fecha.
2. Desplegá «+ Agregar invitado por el día».
3. Escribí un nombre nuevo o elegí un invitado anterior o jugador inactivo.
4. Tocá «Agregar a la lista de este día». Se agrega como presente; podés corregir su marca.
5. Tocá «Guardar asistencia». Desde Parejas ya podés emparejarlo manualmente con los otros presentes.

La incorporación solo corresponde a la fecha y al turno seleccionados. No aparece automáticamente en clases siguientes, no suma al contador de jugadores activos ni recibe avisos de faltas como jugador habitual. Si ya es inactivo, conserva ese estado y su ficha original.
El invitado se guarda con una identidad reutilizable, fuera del plantel habitual. No se permite incluirlo en dos turnos de una misma fecha. Los nombres ya registrados se detectan para evitar altas duplicadas; para un jugador activo se sigue usando Cambio de turno por esta fecha.

## Corregir o descartar

Antes de guardar, quitar un invitado o descartar la asistencia conserva los registros previos. Un invitado nuevo descartado no queda cargado en el catálogo.
«Quitar de esta fecha» quita esa participación al guardar, sin borrar sus otras visitas. Si tenía una pareja ese día, también se quita ese emparejamiento y se avisa antes. Su compañero queda disponible.
Si falla el guardado, el borrador se conserva para reintentar y no se anuncia éxito ni se agrega parcialmente al jugador.

## Reutilizar y convertir

Para una visita posterior, seleccioná la misma persona en Asistencia → Agregar invitado por el día. No hace falta escribirla de nuevo.
En Jugadores → Invitados anteriores se pueden consultar fichas de todos los turnos. La búsqueda global también los encuentra.
Desde la ficha del invitado, «Convertir en jugador habitual» permite elegir turno y sumarlo al plantel activo desde hoy. Conserva el mismo identificador, todas sus visitas, parejas y notas; no completa padrones anteriores a la conversión. Un registro ya guardado ese mismo día conserva el turno en el que participó.
Eliminar definitivamente desde Invitados anteriores quita su identidad y todos sus registros individuales, con confirmación, como para el resto de jugadores.

## Funciones conservadas

- Lunes, miércoles y viernes; turnos 1 (15–17), 2 (17–19) y 3 (19–21).
- Jugadores fijos por turno y excepciones por fecha, sin duplicar faltas en el origen.
- Marcas presente/falta/justificada, pendientes y cancelación; resumen de marcas y aviso antes de guardar con jugadores sin marcar.
- Parejas manuales, memoria de última pareja y advertencia que permite repetir.
- Búsqueda global, fichas, notas y estadísticas mensuales por turno, exportación CSV.
- Planes por fecha y turno con imagen, texto o ambos.
- Seguimiento de faltas de jugadores activos; listado en Jugadores, aviso compacto opcional en Inicio y configuración para reactivarlo.
- Inicio con contadores del turno y próximo entrenamiento; escudo y colores del club.

## Biblioteca y planes

En Más → Ejercicios se crean, editan y buscan ejercicios por título, objetivo o categoría. Pueden tener una imagen y duración opcionales. En Lista → Plan del entrenamiento se agregan, quitan y reordenan ejercicios; se pueden copiar los ejercicios de otra fecha del mismo turno, conservando observación e imagen propias. Guardar plan confirma los cambios.

Los planes referencian la biblioteca: editar un ejercicio actualiza sus planes y eliminarlo lo quita de todos ellos, tras confirmación. Si un plan queda sin ejercicios, observación ni imagen, se retira; las asistencias y parejas se conservan. Los planes vacíos que pudiera haber creado 1.19.1 se omiten al cargar/restaurar, para recuperar el acceso a los demás datos.

La ficha del ejercicio muestra total histórico y últimas cuatro fechas; permite consultar los últimos dos meses. Estadísticas muestra tarjetas en celular, tabla en computadora y búsqueda de jugadores. La biblioteca empieza vacía.

## Datos y respaldo

Versión web 1.19.3. JSON formato 6, con ejercicios e identificadores de ejercicios en cada plan. Importa formatos anteriores 2, 3, 4 y 5, además del 6. Las nuevas copias requieren un destino 1.19 o posterior: la APK 1.17.1 y la web 1.18.1 no las admiten. No editar a mano el número del esquema.

Se mantiene el nombre/versión de IndexedDB. Datos locales por dispositivo, navegador y dirección: no hay sincronización. Actualizar la APK con misma firma e identidad conserva los datos locales; no es necesario restaurar un JSON para actualizar. Restaurar una copia reemplaza los datos del destino tras confirmación. Guardar primero una copia reciente con la versión instalada. El ZIP respalda código, no los datos del teléfono.

La exportación Android conserva TmrFiles: archivos temporales privados, escritura UTF-8 y verificación de bytes/SHA-256. La web solo anuncia éxito nativo con verified verdadero y bytesWritten positivo. Las claves y los datos personales no están incluidos en este ZIP.

## Correcciones 1.19.3

- Eliminar un ejercicio no deja planes vacíos inválidos; se conserva cualquier observación, imagen y ejercicio restante.
- Guardar un ejercicio espera a que termine la preparación de la foto. Cancelar o abrir otro formulario invalida resultados anteriores; si se eligen varias fotos, prevalece la última selección.
- Rutas del ZIP normalizadas con /, con recursos y fuentes en sus carpetas.

## Uso y comprobaciones


99 comprobaciones automáticas de migración, planes vacíos, imágenes concurrentes/canceladas, puntajes, parejas, borradores y contrato de exportación JS. Sintaxis y recursos verificados. No equivalen a una prueba física del teléfono ni a la suite del artifact de otra sesión.

## Usabilidad 1.19.3

Temporizador retirado por decisión del usuario. La barra móvil queda Inicio, Lista, Plantel, Ejercicios y Más. La sección, mini barra y script ya no se cargan; las preferencias antiguas del temporizador en localStorage no se borran ni afectan los entrenamientos. El margen para la navegación ahora se mide desde app.js.

Ayudas largas plegables, aviso de actualización compacto/cerrable, acciones de descarte discretas, historial antes de compañeros en la ficha y mensajes vacíos más breves. No cambian esquema 6 ni reglas estadísticas. El caso de parejas de Claude sigue pendiente del JSON ficticio: no se cambió lógica de cálculo sin reproducirlo.

## Fuente y pruebas

Fuente versionada en Pimborito/tmr-apk, rama review/usabilidad-1.19.3. Web operativa en android-update/www (con integración Android preparada); ZIP adjunto es variante web. Pruebas fuera de la carpeta publicada, en .github/scripts:

```sh
node .github/scripts/test-corrections-1192.cjs android-update/www/app.js
TZ=America/Argentina/Buenos_Aires node .github/scripts/test-ratings-1192.cjs android-update/www/app.js
node .github/scripts/test-usability-1193.cjs android-update/www/app.js
python3 .github/scripts/test-native-export.py
```

Las primeras tres ejecutan 38, 50 y 11 comprobaciones JS. La suite Java conserva 38 comprobaciones y necesita Java 17 y la disposición de fuentes nativas del proyecto Android. El workflow reconstruye primero el ZIP base y aplica el overlay; también retira www/timer.js del ZIP base anterior. Las pruebas nativas se ejecutan al compilar Android. Esta entrega no genera una APK nueva ni publica alojamiento.
