#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <UserNotifications/UserNotifications.h>
#include <node_api.h>

typedef struct {
  napi_deferred deferred;
  napi_threadsafe_function tsfn;
  char *value;
} PendingCall;

static void resolveOnJsThread(napi_env env, napi_value js_callback, void *context, void *data) {
  PendingCall *call = (PendingCall *)data;
  if (env != NULL) {
    napi_value result;
    napi_create_string_utf8(env, call->value, NAPI_AUTO_LENGTH, &result);
    napi_resolve_deferred(env, call->deferred, result);
  }
  free(call->value);
  free(call);
}

static PendingCall *startCall(napi_env env, const char *name, napi_value *promise) {
  PendingCall *call = (PendingCall *)calloc(1, sizeof(PendingCall));
  napi_create_promise(env, &call->deferred, promise);
  napi_value resource_name;
  napi_create_string_utf8(env, name, NAPI_AUTO_LENGTH, &resource_name);
  napi_create_threadsafe_function(env, NULL, NULL, resource_name, 0, 1, NULL, NULL, NULL,
                                  resolveOnJsThread, &call->tsfn);
  return call;
}

static void finishCall(PendingCall *call, const char *value) {
  call->value = strdup(value);
  napi_threadsafe_function tsfn = call->tsfn;
  napi_call_threadsafe_function(tsfn, call, napi_tsfn_blocking);
  napi_release_threadsafe_function(tsfn, napi_tsfn_release);
}

static const char *authorizationName(UNAuthorizationStatus status) {
  switch (status) {
    case UNAuthorizationStatusAuthorized:
      return "authorized";
    case UNAuthorizationStatusProvisional:
      return "provisional";
    case UNAuthorizationStatusDenied:
      return "denied";
    case UNAuthorizationStatusNotDetermined:
      return "not-determined";
    default:
      return "unknown";
  }
}

static UNUserNotificationCenter *currentCenter(void) {
  if ([[NSBundle mainBundle] bundleIdentifier] == nil) return nil;
  @try {
    return [UNUserNotificationCenter currentNotificationCenter];
  } @catch (NSException *exception) {
    return nil;
  }
}

static napi_value status(napi_env env, napi_callback_info info) {
  napi_value promise;
  PendingCall *call = startCall(env, "notificationPermissionStatus", &promise);
  UNUserNotificationCenter *center = currentCenter();
  if (center == nil) {
    finishCall(call, "unknown");
    return promise;
  }
  [center getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
    finishCall(call, authorizationName(settings.authorizationStatus));
  }];
  return promise;
}

static napi_value request(napi_env env, napi_callback_info info) {
  napi_value promise;
  PendingCall *call = startCall(env, "notificationPermissionRequest", &promise);
  UNUserNotificationCenter *center = currentCenter();
  if (center == nil) {
    finishCall(call, "unknown");
    return promise;
  }
  UNAuthorizationOptions options =
      UNAuthorizationOptionAlert | UNAuthorizationOptionSound | UNAuthorizationOptionBadge;
  [center requestAuthorizationWithOptions:options
                        completionHandler:^(BOOL granted, NSError *error) {
                          finishCall(call, error != nil ? "error" : (granted ? "granted" : "refused"));
                        }];
  return promise;
}

static napi_value teamSigned(napi_env env, napi_callback_info info) {
  bool signedByTeam = false;
  SecCodeRef code = NULL;
  if (SecCodeCopySelf(kSecCSDefaultFlags, &code) == errSecSuccess) {
    SecStaticCodeRef staticCode = NULL;
    if (SecCodeCopyStaticCode(code, kSecCSDefaultFlags, &staticCode) == errSecSuccess) {
      CFDictionaryRef signing = NULL;
      if (SecCodeCopySigningInformation(staticCode, kSecCSSigningInformation, &signing) ==
          errSecSuccess) {
        CFTypeRef team = CFDictionaryGetValue(signing, kSecCodeInfoTeamIdentifier);
        signedByTeam = team != NULL && CFGetTypeID(team) == CFStringGetTypeID() &&
                       CFStringGetLength((CFStringRef)team) > 0;
        CFRelease(signing);
      }
      CFRelease(staticCode);
    }
    CFRelease(code);
  }
  napi_value result;
  napi_get_boolean(env, signedByTeam, &result);
  return result;
}

static napi_value bundleId(napi_env env, napi_callback_info info) {
  NSString *identifier = [[NSBundle mainBundle] bundleIdentifier];
  napi_value result;
  if (identifier == nil) {
    napi_get_null(env, &result);
  } else {
    napi_create_string_utf8(env, [identifier UTF8String], NAPI_AUTO_LENGTH, &result);
  }
  return result;
}

static napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
      {"status", NULL, status, NULL, NULL, NULL, napi_default, NULL},
      {"request", NULL, request, NULL, NULL, NULL, napi_default, NULL},
      {"teamSigned", NULL, teamSigned, NULL, NULL, NULL, napi_default, NULL},
      {"bundleId", NULL, bundleId, NULL, NULL, NULL, napi_default, NULL},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
