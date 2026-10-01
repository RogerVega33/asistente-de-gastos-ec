# Política de privacidad de Asistente de Gastos EC

Asistente de Gastos EC es una extensión de navegador desarrollada para facilitar la descarga de comprobantes electrónicos y el llenado asistido del anexo de gastos personales en las páginas del Servicio de Rentas Internas (SRI) de Ecuador.

La extensión procesa información en el navegador del usuario. No envía el archivo CSV a servidores externos ni transmite los datos de las facturas a servidores del desarrollador. Los valores utilizados para completar el anexo se introducen en el portal del SRI a petición del usuario. El desarrollador no recibe ni tiene acceso a esos datos mediante la extensión.

## Información que utiliza

La extensión utiliza únicamente la información necesaria para sus funciones:

- **Archivo CSV seleccionado por el usuario:** nombre del archivo, RUC de proveedores, números de factura e importes de las categorías de gastos personales.
- **Información de las páginas del SRI:** datos de proveedores y facturas, valores deducibles, límites disponibles y elementos del formulario necesarios para comparar y completar los campos.
- **Información de las descargas solicitadas:** período y tipo de comprobante seleccionados, formatos XML o PDF, nombres de archivo, identificadores de tareas y estado de las descargas.
- **Información técnica temporal:** identificadores de pestañas y documentos del navegador para comunicar el panel lateral con la página correspondiente del SRI.

La extensión no solicita ni almacena las credenciales de acceso al SRI. El usuario inicia sesión directamente en el portal del SRI.

## Para qué se utiliza la información

La información se utiliza para comparar las facturas visibles con el CSV, comprobar los importes y completar los campos cuando el usuario lo solicita. La extensión no pulsa el botón Guardar ni presenta el anexo: el usuario debe revisar los valores y realizar esas acciones en el SRI.

También se utiliza para consultar los comprobantes del período elegido, activar las descargas solicitadas, asignar nombres a los archivos y mostrar el progreso o los errores de descarga.

## Almacenamiento y eliminación

El contenido procesado del CSV y el estado temporal de las operaciones se conservan en la memoria de la sesión del navegador mediante `chrome.storage.session`. No se sincronizan con una cuenta de Google ni se almacenan en servidores del desarrollador. Cerrar únicamente el panel lateral no elimina estos datos; se eliminan al finalizar la sesión del navegador o al desinstalar la extensión.

El usuario puede retirar el CSV cargado mediante el botón **Quitar** del panel. Esta acción elimina la copia procesada que conserva la extensión.

Los comprobantes XML y PDF descargados se guardan en el equipo según la configuración de descargas de Chrome. Permanecen allí hasta que el usuario los elimine. Quitar el CSV, cerrar el navegador o desinstalar la extensión no borra esos archivos ni los datos que el usuario haya guardado en el SRI.

## Comunicaciones y terceros

La extensión interactúa con las páginas HTTPS de `sriservicios.sri.gob.ec` y `srienlinea.sri.gob.ec` para realizar las operaciones solicitadas. Estas acciones utilizan la sesión que el usuario ha iniciado en el SRI y pueden generar solicitudes al propio SRI. El tratamiento de la información dentro de ese servicio corresponde al SRI.

La extensión no transmite el CSV ni los datos de las facturas al desarrollador, a servicios de publicidad ni a servicios de analítica. No incorpora seguimiento publicitario ni vende, alquila o comparte esos datos con terceros para fines comerciales.

## Permisos del navegador

- **Panel lateral (`sidePanel`):** muestra la interfaz mientras el usuario trabaja en el SRI.
- **Almacenamiento (`storage`):** mantiene temporalmente el CSV procesado y el estado de las operaciones durante la sesión del navegador.
- **Descargas (`downloads`):** asigna nombres a los comprobantes y detecta la finalización o interrupción de las descargas para controlar su secuencia.
- **Acceso a los dos dominios del SRI indicados:** permite leer e interactuar con los formularios y comprobantes necesarios para las funciones de la extensión.

## Uso limitado de los datos

La información se utiliza exclusivamente para las funciones descritas y solicitadas por el usuario, de acuerdo con los requisitos de uso limitado de la Política de Datos de Usuario de Chrome Web Store. No se utiliza para publicidad personalizada, creación de perfiles comerciales, evaluación de solvencia crediticia ni concesión de préstamos.

## Consultas y cambios

La información del proyecto y sus canales públicos están disponibles en el [repositorio de Asistente de Gastos EC](https://github.com/RogerVega33/asistente-de-gastos-ec).

Si cambia el tratamiento de la información, esta política se actualizará en este mismo documento.

Asistente de Gastos EC es una herramienta independiente, sin afiliación ni respaldo del Servicio de Rentas Internas.
