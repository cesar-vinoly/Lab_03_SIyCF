#pragma once

/* ESP32-WROOM-32D. Los GPIO del motor, encoder y HC-SR04 son los del Lab 1. */
#define PIN_STEP                 25
#define PIN_DIR                  26
#define PIN_EN                   27
#define PIN_MS1                  32
#define PIN_MS2                  33
#define PIN_ENCODER              23
#define PIN_TRIG                 18
#define PIN_ECHO                 19
#define PIN_SERVO                16
#define PIN_INDUCTIVO            34  /* Entrada con pull-up EXTERNO a 3,3 V. */

/* Clasificación de una pieza por ciclo. Distancias desde el transductor. */
#define DISTANCIA_ENTRADA_CM     12.0f
/* Caida no metalicos: 44,6-47,5 cm. Margen hasta 60 cm; excluye silla a 114 cm. */
#define DISTANCIA_SEGUIMIENTO_MAX_CM 60.0f /* 0 desactiva el limite y acepta ecos del fondo. */
#define DISTANCIA_EMPUJE_METAL_CM 32.0f /* Iniciar el barrido al alcanzar esta distancia desde el sensor. */
#define ESPERA_CLASIFICACION_MS  1000 /* Tiempo para terminar de colocar la pieza antes de arrancar. */
#define MEMORIA_METAL_MS         2000 /* No acortar la captura previa al acelerar el arranque. */
#define METAL_INMEDIATO          0   /* 1: omite la espera de clasificacion, conserva la del servo. */
#define MUESTRAS_PRESENCIA       2
#define MUESTRAS_AUSENCIA        3
#define MUESTRAS_FIN_TRANSPORTE  5   /* Parar tras 5 lecturas sin pieza; no por tiempo de marcha. */
/* Una caja puede perder el haz antes de caer. Margen acotado para recuperar eco;
 * no es una confirmacion de salida ni una distancia calculada con el TS. */
#define RECUPERACION_ECO_NO_METAL_MS 5000
#define DISTANCIA_SALIDA_NO_METAL_CM 45.0f
#define MUESTRAS_ZONA_SALIDA     2
#define MUESTRAS_REARME          5   /* Ausencias ultrasonicas para volver a ESPERA. */
#define ENSAYO_PREPARACION_MS    10000 /* Cuenta previa a captura manual; de 1 a 60 s. */
/* La prueba contiene 100 muestras a 100 ms. Cambiarlo requiere reentrenar la IA. */

#if ENSAYO_PREPARACION_MS < 1000 || ENSAYO_PREPARACION_MS > 60000
#error "La preparacion del ensayo manual debe estar entre 1000 y 60000 ms."
#endif

/* MG996R posicional. Los grados son una escala de mando: calibrar en el montaje. */
#define SERVO_INVERTIR           1
#define SERVO_CENTRO_GRADOS      90
/* Compensacion mecanica: negativo acerca la pala a la cinta con SERVO_INVERTIR=1.
 * Conserva 90 como centro logico y el barrido relativo de 60 grados. */
#define SERVO_AJUSTE_GRADOS      (-8)
/* Pulsos calibrados: centro ~1444 us; desvio ~778 us. */
#define SERVO_DESVIO_GRADOS      60
#define SERVO_PULSO_MIN_US       500
#define SERVO_PULSO_MAX_US       2500
#define SERVO_VELOCIDAD_GRADOS_S 60  /* Conserva la pendiente de pulso anterior: unos 667 us/s. */
#define SERVO_ESTABILIZACION_MS  200
#define SERVO_PREPARACION_MS    (((1000 * SERVO_DESVIO_GRADOS + SERVO_VELOCIDAD_GRADOS_S - 1) / SERVO_VELOCIDAD_GRADOS_S) + SERVO_ESTABILIZACION_MS)
#define PRUEBA_SOLO_SERVO        0   /* 1: alterna centro/desvio cada 3 s, motor siempre deshabilitado. */

/* El modelo predice RPM del MOTOR a partir de STEP en Hz. */
#define CONSIGNA_MOTOR_RPM       80.0f
#define STEP_MIN_HZ              40
#define STEP_MAX_HZ              4000
#define MOTOR_PASOS_VUELTA       200
#define MOTOR_MICROPASOS         8   /* TMC2208: MS1=0, MS2=0, igual que Lab 1. */
#define DIRECTO_MAX_RPM          150.0f
#define DIRECTO_ACEL_RPM_S       120.0f
#define DIRECTO_FRENO_RPM_S      300.0f
#define ACTUADORES_PERIODO_MS    20  /* Rampa fina; el TS y los sensores siguen a 100 ms. */
#define RAMPA_HZ_S               1600.0f
#define CONTROL_KP_HZ_RPM        2.0f
#define CONTROL_KI_HZ_RPM_S      8.0f
#define CONTROL_BANDA_RPM        1.0f
#define CONTROL_CORRECCION_MAX   0.20f /* Fraccion de la base TS que puede corregir el PI. */
#define ENCODER_FILTRO_ALPHA     0.25f
#define ENCODER_MAX_MOTOR_RPM    180.0f /* Margen sobre los 150 RPM del ensayo a 4000 Hz. */
#define ENCODER_PULSOS_VUELTA    20
#define DIENTES_MOTOR            19.0f
#define DIENTES_RODILLO          40.0f
/* RPM por varios periodos reales, no por el ultimo flanco aislado. */
#define ENCODER_VENTANA_PERIODOS 4
#define ENCODER_MIN_PERIODOS     3
#define ENCODER_REINICIO_US      2000000LL
/* Calificar los anchos alto y bajo ANTES de usar el pulso para medir periodo.
 * Un rebote breve no debe borrar toda la ventana de RPM. */
#define ENCODER_PULSO_MIN_US     500LL
/* A 180 RPM de motor, 20 pulsos/vuelta de rodillo y relacion 40/19:
 * unos 35088 us entre flancos. Evaluado como constante; sin float en la ISR. */
#define ENCODER_PERIODO_MIN_US ((int64_t)(60000000.0 * DIENTES_RODILLO / (ENCODER_PULSOS_VUELTA * DIENTES_MOTOR * ENCODER_MAX_MOTOR_RPM)) + 1)

#if ENCODER_MIN_PERIODOS < 2 || ENCODER_MIN_PERIODOS > ENCODER_VENTANA_PERIODOS
#error "Revisar la ventana del encoder."
#endif
#if RECUPERACION_ECO_NO_METAL_MS < 500 || RECUPERACION_ECO_NO_METAL_MS > 10000 || MUESTRAS_ZONA_SALIDA < 2
#error "Revisar el margen de recuperacion y confirmacion de zona de salida."
#endif

#if SERVO_CENTRO_GRADOS + SERVO_AJUSTE_GRADOS - SERVO_DESVIO_GRADOS < 0 || SERVO_CENTRO_GRADOS + SERVO_AJUSTE_GRADOS + SERVO_DESVIO_GRADOS > 180
#error "Revisar los angulos configurados para el servo."
#endif

#if SERVO_PULSO_MIN_US <= 0 || SERVO_PULSO_MAX_US <= SERVO_PULSO_MIN_US || SERVO_PULSO_MAX_US >= 20000
#error "Revisar los anchos de pulso del servo."
#endif
#if SERVO_VELOCIDAD_GRADOS_S <= 0 || SERVO_ESTABILIZACION_MS < 0
#error "Revisar los tiempos de movimiento del servo."
#endif
#if MUESTRAS_PRESENCIA < 1 || MUESTRAS_AUSENCIA < 1 || MUESTRAS_FIN_TRANSPORTE < 1 || MUESTRAS_REARME < 1
#error "Los filtros de presencia y ausencia necesitan al menos una muestra."
#endif
