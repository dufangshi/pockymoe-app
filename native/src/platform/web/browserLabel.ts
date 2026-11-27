// Replaces the Web's user-agent label: the account lists this app by device and system.
import * as Device from 'expo-device';
import { Platform } from 'react-native';

export function browserLabel(): string {
  const system = Platform.OS === 'ios' ? (Device.deviceType === Device.DeviceType.TABLET ? 'iPadOS' : 'iOS') : 'Android';
  const model = Device.modelName?.trim();
  return `Pockymoe app · ${model ? `${model} · ` : ''}${system}`.slice(0, 80);
}
