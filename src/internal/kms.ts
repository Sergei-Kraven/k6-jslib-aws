import { JSONArray, JSONObject } from 'k6'
import http, { RefinedResponse, ResponseType } from 'k6/http'

import { AWSClient, AWSRequest } from './client'
import { AWSError } from './error'
import { AWSConfig } from './config'
import { InvalidSignatureError, URIEncodingConfig } from './signature'
import { HTTPMethod, HTTPHeaders } from './http'

/**
 * Class allowing to interact with Amazon AWS's KMS service
 */
export class KMSClient extends AWSClient {
    method: HTTPMethod
    commonHeaders: HTTPHeaders

    /**
     * Create a KMSClient
     * @param  {AWSConfig} awsConfig - configuration attributes to use when interacting with AWS' APIs
     */
    constructor(awsConfig: AWSConfig) {
        const URIencodingConfig = new URIEncodingConfig(true, false)
        super(awsConfig, 'kms', URIencodingConfig)

        // this.serviceName = 'kms'

        // All interactions with the KMS service
        // are made via the GET or POST method.
        this.method = 'POST'

        this.commonHeaders = {
            'Accept-Encoding': 'identity',
            'Content-Type': 'application/x-amz-json-1.1',
        }
    }

    /**
     * Gets a list of all the KMS keys in the caller's AWS
     * account and region.
     *
     * @returns an array of all the available keys
     */
    listKeys(): Array<KMSKey> {
        const body = ''
        const signedRequest: AWSRequest = super.buildRequest(this.method, this.host, '/', '', '', {
            ...this.commonHeaders,
            'X-Amz-Target': `TrentService.ListKeys`,
        })

        const res = http.request(this.method, signedRequest.url, body, {
            headers: signedRequest.headers,
        })
        this._handle_error('ListKeys', res)

        const json: JSONArray = res.json('Keys') as JSONArray
        return json.map((k) => KMSKey.fromJSON(k as JSONObject))
    }

    /**
     * GenerateDataKey returns a unique symmetric data key for use outside of AWS KMS.
     *
     * This operation returns a plaintext copy of the data key and a copy that is encrypted under a symmetric encryption KMS key that you specify.
     * The bytes in the plaintext key are random; they are not related to the caller or the KMS key.
     * You can use the plaintext key to encrypt your data outside of AWS KMS and store the encrypted data key with the encrypted data.
     *
     * To generate a data key, specify the symmetric encryption KMS key that will be used to encrypt the data key.
     * You cannot use an asymmetric KMS key to encrypt data keys.
     *
     * Used to generate data key with the KMS key defined
     * @param {string} id - Specifies the symmetric encryption KMS key that encrypts the data key. Use its key ID, key ARN, alias name, or alias ARN.
     * @param {KMKeySize} size - Specifies the length of the data key in bytes. For example, use the value 64 to generate a 512-bit data key (64 bytes is 512 bits). Default is 32, and generates a 256-bit data key.
     * @throws {KMSServiceError}
     * @throws {InvalidSignatureError}
     * @returns {KMSDataKey} - The generated data key.
     */
    generateDataKey(id: string, size: KMSKeySize = KMSKeySize.Size256): KMSDataKey | undefined {
        const body = JSON.stringify({ KeyId: id, NumberOfBytes: size })
        const signedRequest: AWSRequest = super.buildRequest(
            this.method,
            this.host,
            '/',
            '',
            body,
            {
                ...this.commonHeaders,
                'X-Amz-Target': `TrentService.GenerateDataKey`,
            }
        )
        const res = http.request(this.method, signedRequest.url, body, {
            headers: signedRequest.headers,
        })
        this._handle_error('GenerateDataKey', res)

        return KMSDataKey.fromJSON(res.json() as JSONObject)
    }

    // TODO: operation should be an enum
    _handle_error(operation: string, response: RefinedResponse<ResponseType | undefined>) {
        const errorCode = response.error_code
        if (errorCode === 0) {
            return
        }

        const error = response.json() as JSONObject
        if (errorCode >= 1400 && errorCode <= 1499) {
            // In the event of certain errors, the message is not set.
            // Also, note the inconsistency in casing...
            const errorMessage: string =
                (error.Message as string) || (error.message as string) || (error.__type as string)

            // Handle specifically the case of an invalid signature
            if (error.__type === 'InvalidSignatureException') {
                throw new InvalidSignatureError(errorMessage, error.__type)
            }

            // Otherwise throw a standard service error
            throw new KMSServiceError(errorMessage, error.__type as string, operation)
        }

        if (errorCode === 1500) {
            throw new KMSServiceError(
                'An error occured on the server side',
                'InternalServiceError',
                operation
            )
        }
    }
}

/**
 * Class representing a KMS key
 */
export class KMSKey {
    /**
     * ARN of the key
     */
    keyArn: string

    /**
     * Unique identifier of the key
     */
    keyId: string

    constructor(keyArn: string, KeyId: string) {
        this.keyArn = keyArn
        this.keyId = KeyId
    }

    static fromJSON(json: JSONObject) {
        return new KMSKey(json.KeyArn as string, json.KeyId as string)
    }
}

/**
 * Class representing a data key
 */
export class KMSDataKey {
    /**
     * The Amazon Resource Name (key ARN) of the KMS key that encrypted the data key.
     */
    id: string

    /**
     * The (base64-encoded) encrypted copy of the data key.
     */
    ciphertextBlob: string

    /**
     * The plaintext data key.
     * Use this data key to encrypt your data outside of KMS. Then, remove it from memory as soon as possible.
     */
    plaintext: string

    constructor(CiphertextBlob: string, KeyId: string, Plaintext: string) {
        this.ciphertextBlob = CiphertextBlob
        this.id = KeyId
        this.plaintext = Plaintext
    }

    static fromJSON(json: JSONObject) {
        return new KMSDataKey(
            json.CiphertextBlob as string,
            json.KeyId as string,
            json.Plaintext as string
        )
    }
}

export class KMSServiceError extends AWSError {
    operation: string

    /**
     * Constructs a KMSServiceError
     *
     * @param  {string} message - human readable error message
     * @param  {string} code - A unique short code representing the error that was emitted
     * @param  {string} operation - Name of the failed Operation
     */
    constructor(message: string, code: string, operation: string) {
        super(message, code)
        this.name = 'KMSServiceError'
        this.operation = operation
    }
}

/**
 *  KMSKeyLength describes possible key lenght values for KMS API data key operations.
 */
enum KMSKeySize {
    Size256 = 32,
    Size512 = 64,
}
