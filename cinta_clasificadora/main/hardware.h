#pragma once
#include <stdbool.h>
#include <stdint.h>

void hardware_iniciar(void);
void ultrasonido_disparar(void);
float ultrasonido_leer_cm(void);
bool inductivo_consumir_flanco(void);
bool inductivo_activo(void);
bool encoder_rpm_motor(float *rpm);
void encoder_reiniciar(void);
uint32_t encoder_rechazados(void);
void servo_posicionar(bool desviar);
void servo_actualizar(float dt_s);
bool servo_centro_listo(void);
unsigned servo_pulso_us(void);
unsigned motor_aplicar(unsigned hz);

void motor_direccion(bool adelante);
float servo_angulo_ordenado(void);
