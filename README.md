# Cooper Logistics

Sitio web estático para Cooper/T. Smith de México.

Incluye:
- Landing page
- Agendamiento de citas
- Confirmación con QR
- Panel administrativo local
- Dashboard con gráficas
- Exportación CSV
- Flujo QR automático:
  - Confirmada
  - En proceso
  - Completada

Credenciales del panel admin:
- Usuario: admin
- Contraseña: admin123

Funcionamiento QR:
1. Al llenar el formulario, la cita queda como Confirmada.
2. Al escanear el QR por primera vez, cambia a En proceso.
3. Al escanear el QR por segunda vez, cambia a Completada.

Nota:
Este proyecto es una demo estática. Las citas se guardan en localStorage del navegador. El código está almacenado en GitHub y desplegado en Vercel.