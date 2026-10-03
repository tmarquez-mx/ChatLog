# Reportes de distribución de ChatLog

La opción elegida es Google Analytics conectado a la ficha de Chrome Web Store. Los reportes se consultan en los paneles de Google, sin incorporar un panel público ni enviar los registros locales. Esta versión local no activa la integración en tu cuenta.

## Activar la conexión

1. Entra con la cuenta propietaria a [ChatLog en el panel de desarrolladores](https://chrome.google.com/webstore/devconsole/5cd1c282-b98d-402e-9901-e6501e1bb8a0/faipejgfejnoaigphcdbdeppgjmdaobn/edit/privacy). La ficha pública es [ChatLog en Chrome Web Store](https://chromewebstore.google.com/detail/chatlog/faipejgfejnoaigphcdbdeppgjmdaobn?hl=es).
2. Abre **Ficha de Play Store / Store listing**. Busca **Métricas adicionales / Additional metrics**.
3. Pulsa **Opt in to Google Analytics** o su equivalente en español. Google administra la propiedad; no necesitas crear un identificador `G-…` ni añadir código a la extensión.
4. Revisa el correo de confirmación y abre [Google Analytics](https://analytics.google.com/) con esa misma cuenta. Selecciona la propiedad cuyo nombre corresponde al identificador `faipejgfejnoaigphcdbdeppgjmdaobn`.
5. Consulta las visitas a la ficha, adquisición de tráfico y el evento `install`. Los datos de origen de campañas pueden tardar entre 24 y 48 horas en finalizar.

## Informe mensual para la jefatura

Usa el mismo periodo y registra la fecha de extracción. Descarga los CSV disponibles en Chrome Web Store y conserva una copia mensual para comparar periodos.

| Indicador | Fuente | Interpretación |
| --- | --- | --- |
| Instalaciones y desinstalaciones | Chrome Web Store | Distribución y bajas durante el periodo; no equivale a personas únicas. |
| Usuarios semanales según la tienda | Chrome Web Store | Estimación asociada a instalaciones; no demuestra uso activo del formulario. |
| Impresiones | Chrome Web Store | Exposición en la tienda, distinta de las visitas a la ficha. |
| Visitas y fuentes de tráfico | Google Analytics de la ficha | Alcance y procedencia de las visitas a la ficha, no al sitio promocional. |
| Evento `install` | Google Analytics de la ficha | Se envía cuando se acepta el aviso de permisos; no debe asumirse igual al total de instalaciones de la tienda. |
| Valoraciones | Chrome Web Store | Número y puntuación de opiniones, con su fecha de consulta. |

No presentes como medidos los registros creados, las declaraciones generadas ni el uso por institución: esta integración no observa esas actividades. Para reportar impacto académico harían falta evidencias adicionales, como una encuesta voluntaria, fuera de esta actualización.

La propiedad de la tienda aplica límites: retención de datos configurada a dos meses, acceso agregado y posibles umbrales que ocultan resultados pequeños. Google concede un rol limitado. Para compartir informes sin ampliar acceso al editor de la extensión, puede prepararse un reporte privado en [Looker Studio](https://lookerstudio.google.com/) conectado a esa propiedad; su creación y compartición quedan para una etapa posterior.

## Documentación oficial

- [Integración de Google Analytics con Chrome Web Store](https://developer.chrome.com/docs/webstore/google-analytics)
- [Definiciones y exportación de métricas de Chrome Web Store](https://developer.chrome.com/docs/webstore/metrics)

Documentación verificada el 3 de octubre de 2026. La integración se activa con la cuenta propietaria siguiendo los pasos anteriores; no requiere modificar el ZIP. Al crear la propiedad puede aparecer «Todavía no se han recibido datos de tu sitio web» y una invitación genérica a etiquetar un sitio. En esta integración, Chrome Web Store administra la medición: no añadas ese identificador a la extensión. La existencia de la propiedad no confirma todavía que haya recibido eventos; comprueba los informes tras las visitas a la ficha.
