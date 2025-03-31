import axios, { AxiosError } from 'axios';
import { env } from 'process';

interface OpenSeaAccount {
  address: string;
  username: string | null;
  profile_img_url: string;
}

interface OpenSeaErrorResponse {
  errors?: string[];
}

export const getUserProfileFromOpenSea = async (
  id: string
): Promise<OpenSeaAccount> => {
  const openseaUrl = `https://api.opensea.io/api/v2/accounts/${id}`;
  const apiKey = env.OPENSEA_API_KEY;

  if (!apiKey) {
    console.error('OPENSEA_API_KEY is not set in environment variables.');
    throw new Error('Server configuration error: Missing OpenSea API key.');
  }

  try {
    const response = await axios.get<OpenSeaAccount>(openseaUrl, {
      headers: {
        accept: 'application/json',
        'x-api-key': apiKey,
      },
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<OpenSeaErrorResponse>;
      if (axiosError.response) {
        const status = axiosError.response.status;
        const errorData = axiosError.response.data;
        if (
          (status === 400 || status === 404) &&
          errorData?.errors?.some(
            (err: string) =>
              err.includes('not found') ||
              err.includes('Address or username') ||
              err.includes('Account not found')
          )
        ) {
          throw new Error(`UserNotFound: Address ${id} not found on OpenSea.`);
        }
        console.error(
          `OpenSea API Error: Status ${status}, Data: ${JSON.stringify(errorData)}`
        );
        throw new Error(`Failed to fetch data from OpenSea: Status ${status}`);
      } else if (axiosError.request) {
        console.error(
          'OpenSea API Error: No response received.',
          axiosError.request
        );
        throw new Error('Failed to fetch data from OpenSea: No response.');
      }
    }
    console.error('Error fetching user profile:', error);
    throw new Error(
      'An unexpected error occurred while fetching the user profile.'
    );
  }
};
