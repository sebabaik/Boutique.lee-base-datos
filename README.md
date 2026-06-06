# Boutique Lee - version optimizada

Archivos principales:

- `index.html`: pantallas, modales y pestañas.
- `styles.css`: estilos.
- `firebase-init.js`: conexion a Firebase.
- `app.js`: logica de stock, scanner, QR, historial, ventas y asistente.

Agentes agregados:

- Stock bajo: detecta prendas por talle con stock 0 o 1.
- Resumen diario: calcula ventas, unidades, monto lista, monto efectivo y articulo mas vendido del dia.
- Control de errores: marca prendas incompletas, stock/precios invalidos, duplicados articulo/color y ventas sospechosas.

Tambien se mantiene la mejora de ventas por lote: el descuento de stock y el registro de venta se confirman juntos.
